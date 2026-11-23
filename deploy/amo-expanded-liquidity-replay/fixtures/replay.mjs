import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Block, Transaction } from "bitcoinjs-lib";
import * as raw from "../../../server/work-amo-v5-raw.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS, WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  workAmoV5CanonicalPayloadCommitment, workAmoV5CanonicalStateCommitment, workAmoV5EventSetCommitment,
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
    protocol_record_count:0, raw_protocol_candidate_count:0, transaction_count:0, event_count:0, block_atomic:true,
    fee_once:true, invalid_zero:true, complete:true, current_main_row_sha256:hash("fixture row "+n.sha256),
    payload:{__powNativeStorage:{model:"proof-indexer-native-transition-chunks-v1",sha256:n.sha256}},
    native_sha256:n.sha256, native_bytes:n.bytes, decoded:payload,
  };
}

function seed() {
  const work = raw.normalizeWorkAmoV5RawWorkState({ amountStorageModel:WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms:"0", holders:[], listings:[] });
  const generic = raw.normalizeWorkAmoV5RawGenericState({});
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

// These two headers are synthetic descendants of D. Neither is an observed mainnet block.
function nextBlock(previousHash, height, governed=false) {
  const coinbase = new Transaction();
  coinbase.addInput(Buffer.alloc(32),0xffffffff,0xffffffff,Buffer.from("020101","hex"));
  coinbase.addOutput(Buffer.from("51","hex"),1000n);
  const ordinary = new Transaction();
  ordinary.addInput(Buffer.alloc(32,1),2);
  ordinary.addOutput(governed ? Buffer.from("6a0570776d313a","hex") : Buffer.from("51","hex"),1n);
  coinbase.setWitness(0, [Buffer.alloc(32)]);
  ordinary.setWitness(0, [Buffer.from([1,2,3])]);
  const commitmentPrefix = Buffer.from("6a24aa21a9ed","hex");
  coinbase.addOutput(Buffer.concat([commitmentPrefix,Buffer.alloc(32)]),0n);
  const commitment = Block.calculateMerkleRoot([coinbase,ordinary],true);
  coinbase.outs[1].script=Buffer.concat([commitmentPrefix,commitment]);
  const block = new Block();block.version=1;block.prevHash=Buffer.from(previousHash,"hex").reverse();
  block.transactions=[coinbase,ordinary];block.merkleRoot=Block.calculateMerkleRoot(block.transactions);
  block.timestamp=1800000000+height;block.bits=0x207fffff;block.nonce=0;
  const blockTransactions=[
    {hex:coinbase.toHex(),txid:coinbase.getId(),vin:[{coinbase:"020101"}],vout:coinbase.outs.map(out=>({value:Number(out.value),scriptpubkey:Buffer.from(out.script).toString("hex")}))},
    {hex:ordinary.toHex(),txid:ordinary.getId(),vin:[{txid:Buffer.alloc(32,1).toString("hex"),vout:2}],
      vout:[{value:1,scriptpubkey:Buffer.from(ordinary.outs[0].script).toString("hex")}]},
  ];
  return { block, blockTransactions };
}

function scenario() {
  const sources = { baselineRaw:raw,candidateRaw:raw,binding:{sourceCommit:"1".repeat(40),sourceTree:"2".repeat(40),
    baselineSourceSha256:hashOf(3),candidateSourceSha256:hashOf(4),dependencySha256:hashOf(5)} };
  sources.readBinding=async()=>structuredClone(sources.binding);
  const rows=new Map(), blocks=new Map(), hashes=new Map();let prior=seed();
  hashes.set(D.blockHeight,D.blockHash);rows.set(D.blockHeight,nativeRow(prior));
  for(const height of [977230,977231]) {
    const {block,blockTransactions}=nextBlock(prior.blockHash,height);
    const bh=block.getId();
    const before=raw.replayWorkAmoV5RawBlock({
      blockHeaderHex:block.toHex(true),blockTransactions,expectedBlockHash:bh,expectedBlockHeight:height,
      expectedPreviousBlockHash:prior.blockHash,records:[],openingEconomicState:prior.closingSufficientState,
      openingGenericState:prior.closingGenericTokenState,openingIdState:prior.closingIdState,openingWorkState:prior.closingTokenState,
      workAmoV8:prior.workAmoV8,
    });
    const next={...prior,blockHeight:height,blockHash:bh,previousBlockHash:prior.blockHash,openingSufficientState:prior.closingSufficientState,
      openingStateCommitment:prior.closingStateCommitment,closingSufficientState:before.economicState,closingStateCommitment:before.stateCommitment,
      closingWorkProjection:raw.projectWorkAmoV5RawEvents(prior.closingWorkProjection,before.events,before.workState),
      bip141Witness:before.bip141Witness,blockDescriptorCommitment:before.blockDescriptorCommitment,blockDescriptorModel:before.blockDescriptorModel,
      blockTransactionCount:before.blockTransactionCount,transitionChainModel:before.transitionChainModel,transitionChainCommitment:before.transitionChainCommitment};
    rows.set(height,nativeRow(next));hashes.set(height,bh);blocks.set(bh,block.toHex());prior=next;
  }
  const tip={height:977231,hash:hashes.get(977231)};
  return {rows,hashes,blocks,options:{tip,sources,readTip:async()=>({...tip}), readCanonicalHash:async height=>hashes.get(height),
    readRawBlock:async bh=>blocks.get(bh),readDeclarationEvidence:async()=>structuredClone(declarationEvidence),
    readTransition:async height=>structuredClone(rows.get(height)),readRelations:async()=>({recordCount:0,eventCount:0,
      recordRowsSha256:emptyBindingsHash,eventRowsSha256:emptyBindingsHash}),nativeDigest}};
}

export { declarationEvidence, hashOf, nativeDigest, nativeRow, nextBlock, scenario, txFixture };
