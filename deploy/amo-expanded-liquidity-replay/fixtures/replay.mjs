import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Block, opcodes, script, Transaction } from "bitcoinjs-lib";
import { canonicalRawProtocolRecordSetFromTransaction } from "../../../server/canonical-op-return.mjs";
import { materializeOrdinaryReplay } from "../../work-batch-replay/preflight.mjs";
import { materializeReplay } from "../records.mjs";
import * as raw from "../../../server/work-amo-v5-raw.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS, WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS, WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, WORK_AMO_V5_POWB_TOKEN_ID,
  workAmoV5CanonicalPayloadCommitment, workAmoV5CanonicalStateCommitment, workAmoV5ConsensusEventKind, workAmoV5EventSetCommitment,
} from "../../../server/work-amo-v5.mjs";
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL, WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL, workAmoV8CanonicalTokenStateCommitment } from "../../../server/work-amo-v8.mjs";
import { WORK_SUBATOM_PROJECTION_MODEL } from "../../../server/work-units.mjs";
import { DECLARATION_PINS as D } from "../qualify.mjs";

const txFixture = JSON.parse(readFileSync(new URL("./declaration.json", import.meta.url)));
const hash = value => createHash("sha256").update(value).digest("hex");
const hashOf = n => n.toString(16).padStart(64, "0");
const position = { txid: D.txid, blockHeight: D.blockHeight, blockHash: D.blockHash, blockIndex: D.blockTransactionIndex };
const declarationEvidence = { transaction: { txid: D.txid, hex: txFixture.transactionHex,
  status: { confirmed: true, block_height: D.blockHeight, block_hash: D.blockHash } },
  canonicalBlock: { height:D.blockHeight, hash:D.blockHash, tx:[...Array(D.blockTransactionIndex).fill(hashOf(1)),D.txid] },
  canonicalHash:D.blockHash, indexedPosition:position, prevoutTransactionHex:txFixture.prevoutTransactionHex };

// The native database adapter has a separate disposable PostgreSQL test. This
// fixture's independent in-memory store binds complete serialized payloads.
function nativeDigest(value) {
  const bytes = Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);
  return { sha256:hash(bytes), bytes:bytes.length };
}
const emptyBindingsHash = nativeDigest([]).sha256;

function nativeRow(payload) {
  const n = nativeDigest(payload);
  return {
    network:"livenet", block_height:payload.blockHeight, block_hash:payload.blockHash, previous_block_hash:payload.previousBlockHash,
    model:payload.model, work_token_state_model:payload.workTokenStateModel,
    opening_network_value_q8:payload.openingNetworkValueQ8, closing_network_value_q8:payload.closingNetworkValueQ8,
    state_commitment_model:payload.openingStateCommitment.model, opening_state_sha256:payload.openingStateCommitment.sha256,
    closing_state_sha256:payload.closingStateCommitment.sha256, opening_state_payload_bytes:payload.openingStateCommitment.payloadBytes,
    closing_state_payload_bytes:payload.closingStateCommitment.payloadBytes, event_set_model:payload.eventSetCommitment.model,
    event_set_sha256:payload.eventSetCommitment.sha256, event_set_payload_bytes:payload.eventSetCommitment.payloadBytes,
    protocol_record_count:payload.protocolRecordCount, raw_protocol_candidate_count:payload.rawProtocolCandidateCount,
    transaction_count:payload.transactionCount, event_count:payload.eventCount, block_atomic:true,
    fee_once:true, invalid_zero:true, complete:true, current_main_row_sha256:hash("fixture row "+n.sha256),
    payload:{__powNativeStorage:{model:"proof-indexer-native-transition-chunks-v1",sha256:n.sha256}},
    native_sha256:n.sha256, native_bytes:n.bytes, decoded:payload,
  };
}

function seed(withBond = false) {
  const work = raw.normalizeWorkAmoV5RawWorkState({ amountStorageModel:WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms:"0", holders:[], listings:[] });
  const generic = raw.normalizeWorkAmoV5RawGenericState(withBond ? {
    tokens:[{tokenId:WORK_AMO_V5_POWB_TOKEN_ID, ticker:"POWB", registryAddress:WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS}],
  } : {});
  const id = raw.normalizeWorkAmoV5RawIdState({});
  const state = {
    baseState:Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map(f=>[f,f==="computerEventFlowSats" ? "4200000":"0"])),
    creditFixedQ8:"0", creditMovementFrozenValueQ8:"0", movements:[], quoteHead:null, network:"livenet",
    model:WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, networkValueQ8:"2100000000000000",
    throughBlockHash:D.blockHash, throughBlockHeight:D.blockHeight,
    genericTokenStateCommitment:raw.workAmoV5RawGenericStateCommitment(generic), idStateCommitment:raw.workAmoV5RawIdStateCommitment(id),
    tokenStateCommitment:workAmoV8CanonicalTokenStateCommitment(work),
  };
  const opening = { ...state,throughBlockHeight:D.blockHeight-1,throughBlockHash:hashOf(100) };
  return {
    network:"livenet", model:WORK_AMO_V8_BLOCK_SEQUENCER_MODEL, workTokenStateModel:WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
    blockHeight:D.blockHeight,blockHash:D.blockHash,previousBlockHash:opening.throughBlockHash,
    workAmoV8:{activationHeight:960601,amountStorageModel:WORK_SUBATOM_PROJECTION_MODEL},
    openingSufficientState:opening, openingStateCommitment:workAmoV5CanonicalStateCommitment(opening),
    closingSufficientState:state,closingStateCommitment:workAmoV5CanonicalStateCommitment(state),openingNetworkValueQ8:opening.networkValueQ8,
    closingNetworkValueQ8:state.networkValueQ8,closingTokenState:work,closingGenericTokenState:generic,closingIdState:id,
    closingWorkProjection:raw.projectWorkAmoV5RawEvents({},[],work), blockAtomic:true,feeOnce:true,invalidZero:true,complete:true,
    traces:[],replayRecords:[],replayDescriptorCommitment:workAmoV5CanonicalPayloadCommitment([]),eventSetCommitment:workAmoV5EventSetCommitment([]),
    protocolRecordCount:0,rawProtocolCandidateCount:0,transactionCount:0,eventCount:0,
  };
}

function boostFileCarriers() {
  const bytes = Buffer.from("local replay fixture");
  const encode = value => Buffer.from(value).toString("base64url");
  const media = { mime:"text/plain", name:"fixture.txt", sha256:hash(bytes), size:bytes.length, source:"same-tx-pwm1-attachment" };
  const post = { v:1, text:"Fixture post", media };
  const attachment = ["pwm1:a", encode(media.mime), encode(media.name), media.size, media.sha256, "0/1", encode(bytes)].join(":");
  return ["pwb1:post:" + encode(JSON.stringify(post)), "pwm1:m:Fixture post", attachment];
}

// These headers are synthetic descendants of D. None is an observed mainnet block.
function nextBlock(previousHash, height, governed=false, paired=false) {
  const coinbase = new Transaction();
  coinbase.addInput(Buffer.alloc(32),0xffffffff,0xffffffff,Buffer.from("020101","hex"));
  coinbase.addOutput(Buffer.from("51","hex"),1000n);
  const ordinary = new Transaction();
  let parent;
  if (governed === "boost-file" || governed === "two-recipient-bond") {
    const paymentScript = Buffer.from("0014" + "12".repeat(20), "hex");
    parent = new Transaction();
    parent.addInput(Buffer.alloc(32, 7), height);
    parent.addOutput(paymentScript, 2000n);
    ordinary.addInput(parent.getHash(), 0);
    ordinary.addOutput(paymentScript, 546n);
    if (governed === "two-recipient-bond") ordinary.addOutput(Buffer.from("0014" + "34".repeat(20), "hex"), 345n);
    const texts = governed === "boost-file" ? boostFileCarriers() : ["pwm1:m:powb"];
    for (const text of texts) {
      ordinary.addOutput(script.compile([opcodes.OP_RETURN, Buffer.from(text)]), 0n);
    }
    ordinary.addOutput(paymentScript, governed === "boost-file" ? 1254n : 909n); // 200 sats miner fee.
  } else {
    ordinary.addInput(Buffer.alloc(32,1),2);
    ordinary.addOutput(governed ? Buffer.from("6a0570776d313a","hex") : Buffer.from("51","hex"),1n);
  }
  coinbase.setWitness(0, [Buffer.alloc(32)]);
  ordinary.setWitness(0, [Buffer.from([1,2,3])]);
  const spenders = [{tx:ordinary,parent}];
  if (paired) {
    const otherParent = parent.clone();
    otherParent.locktime = 1;
    const other = ordinary.clone();
    other.ins[0].hash = otherParent.getHash();
    spenders.push({tx:other,parent:otherParent});
    // Deliberately put the greater txid first to distinguish block order from txid order.
    spenders.sort((a,b) => b.tx.getId().localeCompare(a.tx.getId()));
  }
  const transactions = [coinbase, ...spenders.map(spend => spend.tx)];
  const commitmentPrefix = Buffer.from("6a24aa21a9ed","hex");
  coinbase.addOutput(Buffer.concat([commitmentPrefix,Buffer.alloc(32)]),0n);
  const commitment = Block.calculateMerkleRoot(transactions,true);
  coinbase.outs[1].script=Buffer.concat([commitmentPrefix,commitment]);
  const block = new Block();block.version=1;block.prevHash=Buffer.from(previousHash,"hex").reverse();
  block.transactions=transactions;block.merkleRoot=Block.calculateMerkleRoot(transactions);
  block.timestamp=1800000000+height;block.bits=0x207fffff;block.nonce=0;
  const outputs = tx => tx.outs.map(out=>({value:Number(out.value),scriptpubkey:Buffer.from(out.script).toString("hex")}));
  const blockTransactions=[
    {hex:coinbase.toHex(),txid:coinbase.getId(),vin:[{coinbase:"020101"}],vout:outputs(coinbase)},
    ...spenders.map(({tx,parent}) => {
      const input = parent ? {txid:parent.getId(),vout:0,prevout:outputs(parent)[0]} : {txid:Buffer.alloc(32,1).toString("hex"),vout:2};
      return {hex:tx.toHex(),txid:tx.getId(),vin:[input],vout:outputs(tx)};
    }),
  ];
  return {block, blockTransactions, parents:spenders.flatMap(spend => spend.parent ? [spend.parent] : [])};
}

function occupiedRecords(tx, height, blockHash, blockTransactionIndex) {
  const { records } = canonicalRawProtocolRecordSetFromTransaction(tx);
  return records.map(record => ({
    ...record, txid:tx.txid, tx, transactionMinerFeeSats:"200", transactionProtocolRecordCount:records.length,
    position:{blockHeight:height,blockHash,blockTransactionIndex,protocolVout:record.protocolVout,recordOrdinal:record.recordOrdinal},
  }));
}

function occupiedEvidence(replay, records) {
  // The historical ordinary materializer independently reproduces the Boost/file frames.
  // Its historical scope excludes derived token-mint rows.
  let traces, replayRecords;
  if (replay.derivedEventCount === 0) {
    ({ records:replayRecords, traces } = materializeOrdinaryReplay(replay, workAmoV5ConsensusEventKind));
  } else {
    ({ replayRecords, traces } = materializeReplay(replay));
  }
  const eventSetCommitment = workAmoV5EventSetCommitment(replayRecords.map(record => ({
    ...record, valid:record.outcome.valid, payload:record.rawWitness,
  })));
  const physical = records.flatMap(record => record.rawRecordParts.map(part => ({
    txid:record.txid, blockIndex:record.position.blockTransactionIndex, vout:part.protocolVout, outputIndex:0,
    protocol:record.protocol, payloadHex:part.payloadHex, payloadText:part.text, dataBytes:part.payloadHex.length / 2,
  })));
  const events = replayRecords.map(record => {
    const sourceRecord = record.rawCandidate
      ? records.find(row => row.txid === record.txid && row.protocolVout === record.position.protocolVout)
      : null;
    const amount = sourceRecord?.tx.vout.slice(0,record.position.protocolVout)
      .reduce((sum,out) => sum + BigInt(out.value), 0n) ?? 0n;
    return {
      txid:record.txid, blockHeight:record.position.blockHeight, blockIndex:record.position.blockTransactionIndex,
      vout:record.position.protocolVout, ordinal:record.position.recordOrdinal, protocol:record.protocol,
      kind:record.protocol === "pwb1" ? "boost-post" : record.outcome.semanticKind, valid:record.outcome.valid,
      rawPayload:sourceRecord?.message ?? "", amountSats:amount.toString(),
      dataBytes:sourceRecord?.rawRecordParts.reduce((sum,part) => sum + part.payloadHex.length / 2, 0) ?? 0,
      feeSats:record.transactionMinerFeeSats, validationErrors:[], bound:true, rawCandidate:record.rawCandidate,
      outcome:{ kind:record.outcome.kind, reasonCode:record.outcome.reasonCode, valid:record.outcome.valid },
      rawWitness:record.rawWitness, replayOutput:record.output, derivedId:record.rawCandidate ? null : record.rawWitness.descriptor.derivedId,
    };
  });
  const bindings = {recordCount:physical.length, eventCount:events.length,
    recordRowsSha256:nativeDigest(physical).sha256, eventRowsSha256:nativeDigest(events).sha256};
  return { fields:{replayRecords,traces,eventSetCommitment,replayDescriptorCommitment:workAmoV5CanonicalPayloadCommitment(replayRecords)},
    relations:{bindings,records:physical,events} };
}

function scenario({ occupied = false, paired = false } = {}) {
  const sources = { baselineRaw:raw,candidateRaw:raw,binding:{sourceCommit:"1".repeat(40),sourceTree:"2".repeat(40),
    baselineSourceSha256:hashOf(3),candidateSourceSha256:hashOf(4),dependencySha256:hashOf(5)} };
  sources.readBinding=async()=>structuredClone(sources.binding);
  const rows=new Map(), blocks=new Map(), hashes=new Map(), parents=new Map(), relations=new Map();
  let prior=seed(occupied === "two-recipient-bond");
  hashes.set(D.blockHeight,D.blockHash);rows.set(D.blockHeight,nativeRow(prior));
  for(const height of [977230,977231]) {
    const {block,blockTransactions,parents:funding}=nextBlock(prior.blockHash,height,occupied === true ? "boost-file" : occupied,paired);
    const bh=block.getId();
    const records=occupied ? blockTransactions.flatMap((tx,index) => occupiedRecords(tx,height,bh,index)) : [];
    for (const parent of funding) parents.set(parent.getId(),parent.toHex());
    const before=raw.replayWorkAmoV5RawBlock({
      blockHeaderHex:block.toHex(true),blockTransactions,expectedBlockHash:bh,expectedBlockHeight:height,
      expectedPreviousBlockHash:prior.blockHash,records,openingEconomicState:prior.closingSufficientState,
      openingGenericState:prior.closingGenericTokenState,openingIdState:prior.closingIdState,openingWorkState:prior.closingTokenState,
      workAmoV8:prior.workAmoV8,
    });
    const next={...prior,blockHeight:height,blockHash:bh,previousBlockHash:prior.blockHash,openingSufficientState:prior.closingSufficientState,
      openingStateCommitment:prior.closingStateCommitment,closingSufficientState:before.economicState,closingStateCommitment:before.stateCommitment,
      closingWorkProjection:raw.projectWorkAmoV5RawEvents(prior.closingWorkProjection,before.events,before.workState),
      bip141Witness:before.bip141Witness,blockDescriptorCommitment:before.blockDescriptorCommitment,blockDescriptorModel:before.blockDescriptorModel,
      blockTransactionCount:before.blockTransactionCount,transitionChainModel:before.transitionChainModel,transitionChainCommitment:before.transitionChainCommitment};
    if (occupied) {
      const evidence = occupiedEvidence(before, records);
      Object.assign(next, evidence.fields, {
        openingNetworkValueQ8:prior.closingNetworkValueQ8, closingNetworkValueQ8:before.economicState.networkValueQ8,
        closingTokenState:before.workState, closingGenericTokenState:before.genericState, closingIdState:before.idState,
        protocolRecordCount:before.protocolRecordCount, rawProtocolCandidateCount:before.rawProtocolCandidateCount,
        eventCount:evidence.fields.replayRecords.length, transactionCount:before.transactionCount,
      });
      relations.set(height,structuredClone(evidence.relations));
    }
    rows.set(height,nativeRow(next));hashes.set(height,bh);blocks.set(bh,block.toHex());prior=next;
  }
  const tip={height:977231,hash:hashes.get(977231)};
  return {rows,hashes,blocks,parents,relations,options:{tip,sources,readTip:async()=>({...tip}), readCanonicalHash:async height=>hashes.get(height),
    readParentTransaction:async txid=>parents.get(txid),
    readRawBlock:async bh=>blocks.get(bh),readDeclarationEvidence:async()=>structuredClone(declarationEvidence),
    readTransition:async height=>structuredClone(rows.get(height)),readRelations:async height=>structuredClone(relations.get(height) ?? {recordCount:0,eventCount:0,
      recordRowsSha256:emptyBindingsHash,eventRowsSha256:emptyBindingsHash}),nativeDigest}};
}

export { declarationEvidence, hashOf, nativeDigest, nativeRow, nextBlock, scenario, txFixture };
