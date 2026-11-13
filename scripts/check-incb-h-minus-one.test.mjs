import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import {createOwnerOutputCommitmentFixture,signOwnerOutputCommitmentPsbt} from "../tests/fixtures/ownerOutputCommitment.mjs";
import {canonicalRawProtocolRecordSetFromTransaction} from "../server/canonical-op-return.mjs";
import {normalizeWorkAmoV5RawGenericState,normalizeWorkAmoV5RawIdState,normalizeWorkAmoV5RawWorkState,workAmoV5RawGenericStateCommitment,workAmoV5RawIdStateCommitment,replayWorkAmoV5RawBlock,normalizeInceptionHMinusOneWitness,inceptionAttachmentIncrement,INCEPTION_H_MINUS_ONE_REPAIR_HEIGHT} from "../server/work-amo-v5-raw.mjs";
import {WORK_AMO_V5_BASE_STATE_FIELDS,WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,workAmoV5CanonicalStateCommitment} from "../server/work-amo-v5.mjs";
import {workAmoV8CanonicalTokenStateCommitment} from "../server/work-amo-v8.mjs";
import {WORK_SUBATOM_PROJECTION_MODEL,WORK_TOKEN_ID} from "../server/work-units.mjs";
const ACTOR=createOwnerOutputCommitmentFixture().ownerAddress;
const REGISTRY=WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS;
const INCB="3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const HEIGHT=INCEPTION_H_MINUS_ONE_REPAIR_HEIGHT;
const PRIOR_HASH="21".repeat(32),FEE=47;
const OPENING_VALUE=2100000000000000n;
const SUPPLY=21000000n*10000000000000000n;
const sha256d=bytes=>createHash("sha256").update(createHash("sha256").update(bytes).digest()).digest();
const script=address=>bitcoin.address.toOutputScript(address,bitcoin.networks.bitcoin);
const carrier=message=>bitcoin.script.compile([bitcoin.opcodes.OP_RETURN,Buffer.from(message)]);
function hydrated(transaction, prevouts = []) {
  return {
    txid: transaction.getId(),
    hex: transaction.toHex(),
    vin: transaction.ins.map((input, index) => ({
      ...(bitcoin.Transaction.isCoinbaseHash(input.hash)
        ? { coinbase: Buffer.from(input.script).toString("hex") }
        : {
            txid: Buffer.from(input.hash).reverse().toString("hex"),
            vout: input.index,
            scriptsig: Buffer.from(input.script).toString("hex"),
            sequence: input.sequence,
            prevout: prevouts[index],
          }),
    })),
    vout: transaction.outs.map((output) => ({
      scriptpubkey: Buffer.from(output.script).toString("hex"),
      value: output.value.toString(),
    })),
  };
}

function block(transactions, height = HEIGHT) {
  const coinbase = new bitcoin.Transaction();
  coinbase.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from("0401020304", "hex"));
  coinbase.addOutput(Buffer.from("51", "hex"), 0n);
  const blockTransactions = [hydrated(coinbase), ...transactions].map((tx, index) => ({ ...tx, _powBlockIndex: index }));
  let hashes = blockTransactions.map(tx => Buffer.from(tx.txid, "hex").reverse());
  while (hashes.length > 1) {
    if (hashes.length % 2) hashes.push(Buffer.from(hashes.at(-1)));
    hashes = Array.from({ length: hashes.length / 2 }, (_, index) => sha256d(Buffer.concat([hashes[index * 2], hashes[index * 2 + 1]])));
  }
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(PRIOR_HASH, "hex").reverse().copy(header, 4);
  hashes[0].copy(header, 36);
  header.writeUInt32LE(1_700_000_000, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  return {
    blockTransactions,
    blockHeight: height,
    blockHash: Buffer.from(sha256d(header)).reverse().toString("hex"),
    blockHeaderHex: header.toString("hex"),
  };
}

function openingState(height, amount = SUPPLY.toString()) {
  const generic = normalizeWorkAmoV5RawGenericState({ holders: [], listings: [], tokens: [{tokenId: INCB, ticker: "INCB", confirmedSupply: "0", maxSupply: null, mintAmount: "1", mintPriceSats: "1", registryAddress: REGISTRY}] });
  const ids = normalizeWorkAmoV5RawIdState({ records: [], listings: [] });
  const work = normalizeWorkAmoV5RawWorkState({
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms: amount,
    holders: [{ address: ACTOR, balanceSubatoms: amount }],
    listings: [],
  });
  return {
    openingGenericState: generic,
    openingIdState: ids,
    openingWorkState: work,
    openingEconomicState: {
      baseState: Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map(field => [field, field === "computerEventFlowSats" ? "4200000" : "0"])),
      creditFixedQ8: "0", creditMovementFrozenValueQ8: "0",
      genericTokenStateCommitment: workAmoV5RawGenericStateCommitment(generic),
      idStateCommitment: workAmoV5RawIdStateCommitment(ids),
      model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, movements: [], network: "livenet",
      networkValueQ8: OPENING_VALUE.toString(), quoteHead: null,
      throughBlockHash: PRIOR_HASH, throughBlockHeight: height - 1,
      tokenStateCommitment: workAmoV8CanonicalTokenStateCommitment(work),
    },
  };
}


function transaction({amounts=[],parentFirst=true,invalid=false}={}) {
 const funding=new bitcoin.Transaction();
 funding.addInput(Buffer.alloc(32),0xffffffff,0xffffffff,Buffer.from("00","hex"));
 funding.addOutput(script(ACTOR),100000n);
 const psbt=new bitcoin.Psbt();psbt.addInput({hash:funding.getId(),index:0,nonWitnessUtxo:funding.toBuffer(),sequence:0xfffffffd});
 const outputs=[];
 if(!invalid)outputs.push({script:script(ACTOR),value:546n});
 const parent={script:carrier("pwm1:m:incb"),value:0n};
 if(parentFirst)outputs.push(parent);
 for(const amount of amounts)outputs.push({script:script(REGISTRY),value:546n});
 for(const amount of amounts)outputs.push({script:carrier(`pwt1:send3:${WORK_TOKEN_ID}:${amount}:${ACTOR}`),value:0n});
 if(!parentFirst)outputs.push(parent);
 const spent=outputs.reduce((s,o)=>s+o.value,0n);
 outputs.push({script:script(ACTOR),value:100000n-spent-BigInt(FEE)});
 outputs.forEach(o=>psbt.addOutput(o));
 const signed=bitcoin.Psbt.fromHex(signOwnerOutputCommitmentPsbt(psbt.toHex())).extractTransaction();
 return {...hydrated(signed,[{scriptpubkey:Buffer.from(script(ACTOR)).toString("hex"),value:"100000"}]),feeSats:String(FEE)};
}
function fixture(config={}) {
 const height=config.height??HEIGHT; const context=block([transaction(config)],height);
 const records=context.blockTransactions.flatMap((tx,index)=>{
  const set=canonicalRawProtocolRecordSetFromTransaction(tx);
  return set.records.map(r=>({...r,tx,txid:tx.txid,position:{blockHash:context.blockHash,blockHeight:height,blockTransactionIndex:index,protocolVout:r.protocolVout,recordOrdinal:r.recordOrdinal},transactionMinerFeeSats:tx.feeSats,transactionProtocolRecordCount:set.records.length}));
 });
 const options={blockHeaderHex:context.blockHeaderHex,blockTransactions:context.blockTransactions,expectedBlockHash:context.blockHash,expectedBlockHeight:height,expectedPreviousBlockHash:PRIOR_HASH,records,...openingState(height),workAmoV8:{activationHeight:HEIGHT-100}};
 const oracle={model:"canonical-incb-h-minus-one-summary-witness-v1",network:"livenet",status:"green",blockHeight:height-1,blockHash:PRIOR_HASH,snapshotId:"aa".repeat(12),canonicalSummaryHash:"bb".repeat(32),networkValueQ8:(OPENING_VALUE+17n).toString(),dnsOverlayQ8:"17",openingNetworkValueQ8:OPENING_VALUE.toString(),openingStateCommitment:workAmoV5CanonicalStateCommitment(options.openingEconomicState)};
 return {options,oracle};
}
function minted(replay){return replay.events.flatMap(e=>e.derived??[]).filter(x=>x.tokenId===INCB).reduce((s,x)=>s+BigInt(x.amount),0n);}
test("accepted proof-only INCB requires oracle; invalid parent does not",()=>{
 const f=fixture();assert.throws(()=>replayWorkAmoV5RawBlock(f.options),/witness-required/);
 const valid=replayWorkAmoV5RawBlock({...f.options,inceptionHMinusOneWitness:f.oracle});assert.equal(minted(valid),546n);
 assert.equal(valid.economicState.movements.length,0);
 const invalid=fixture({invalid:true});const result=replayWorkAmoV5RawBlock(invalid.options);
 assert.equal(result.events[0].valid,false);assert.equal(minted(result),0n);
});
for(const parentFirst of [true,false])test(`recipient aggregate rounding, parentFirst=${parentFirst}`,()=>{
 const amounts=[5000000000000001n,5000000000000001n];const f=fixture({amounts,parentFirst});
 if (!parentFirst) {
  const rejected=replayWorkAmoV5RawBlock(f.options);
  const bond=rejected.events.find(e=>e.protocol==="pwm1");
  assert.equal(bond.valid,false);assert.equal(bond.reasonCode,"work-amo-v5-pwm-output-conflict");
  assert.equal(minted(rejected),0n);assert.equal(rejected.economicState.movements.length,2);
  return;
 }
 const result=replayWorkAmoV5RawBlock({...f.options,inceptionHMinusOneWitness:f.oracle});
 assert(result.events.every(e=>e.valid),JSON.stringify(result.events.map(e=>({kind:e.semanticKind,reason:e.reasonCode}))));
 const expectedQ8=amounts.reduce((a,b)=>a+b)*BigInt(f.oracle.networkValueQ8)/SUPPLY;
 assert.equal(minted(result),546n+expectedQ8/100000000n);
 const attached=result.events.flatMap(e=>e.derived??[]).filter(d=>d.workSendPosition);
 assert.equal(attached.reduce((s,d)=>s+BigInt(d.attachedWorkLiveValueAtSendQ8),0n),expectedQ8);
 assert.equal(result.economicState.movements.length,2);
 assert.equal(result.economicState.creditMovementFrozenValueQ8,(amounts.reduce((s,a)=>s+a*BigInt(f.oracle.networkValueQ8)/SUPPLY,0n)).toString());
});
test("Q16 incremental arithmetic preserves aggregate proof and Q8 dust",()=>{
 const value=210000000000000000000001n;
 const one=inceptionAttachmentIncrement(1n,true,[],value);
 const two=inceptionAttachmentIncrement(1n,true,[{amountStorageModel:WORK_SUBATOM_PROJECTION_MODEL,amountSubatoms:"1"}],value);
 assert.equal(one.valueQ8+two.valueQ8,2n*value/SUPPLY);
 assert.equal(one.issuanceUnits+two.issuanceUnits,(2n*value/SUPPLY)/100000000n);
 const q8=inceptionAttachmentIncrement(1n,false,[],value),q16=inceptionAttachmentIncrement(100000000n,true,[],value);
 assert.deepEqual(q8,q16);
});
test("witness rejects stale/tampered bindings and permits zero-DNS branch",()=>{
 const {options,oracle}=fixture();
 for(const patch of [{blockHeight:HEIGHT-2},{blockHash:"00".repeat(32)},{status:"red"},{network:"testnet"},{dnsOverlayQ8:"18"},{networkValueQ8:"1.2"},{openingStateCommitment:{...oracle.openingStateCommitment,sha256:"00".repeat(32)}}])assert.throws(()=>normalizeInceptionHMinusOneWitness({...oracle,...patch},options),/witness-invalid/);
 const zero={...oracle,dnsOverlayQ8:"0",networkValueQ8:OPENING_VALUE.toString()};assert.deepEqual(normalizeInceptionHMinusOneWitness(zero,options),zero);
});
test("pre-repair replay remains unwitnessed and rejects witness injection",()=>{
 const {options,oracle}=fixture({height:HEIGHT-1});const result=replayWorkAmoV5RawBlock(options);
 assert.equal(minted(result),546n);assert.equal(result.inceptionHMinusOneWitness,undefined);
 assert.throws(()=>replayWorkAmoV5RawBlock({...options,inceptionHMinusOneWitness:oracle}),/witness-invalid/);
});

test("snapshot pruning protects both mint and transition oracle references",()=>{
 const source=readFileSync(new URL("./backfill-proof-indexer.mjs",import.meta.url),"utf8");
 const start=source.indexOf("async function pruneLedgerSnapshots(");assert(start>=0);
 const query=source.slice(start,source.indexOf("RETURNING",source.indexOf("deleted AS (",start)));
 assert.match(query,/SELECT DISTINCT payload->>'issuanceValueSnapshotId' AS snapshot_id/);
 assert.match(query,/SELECT DISTINCT payload->'inceptionHMinusOneWitness'->>'snapshotId' AS snapshot_id\s+FROM proof_indexer\.work_amo_block_transitions\s+WHERE network = \$1\s+AND block_height >= 975611/);
 assert.match(query,/payload->'inceptionHMinusOneWitness'->>'model' =\s+'canonical-incb-h-minus-one-summary-witness-v1'/);
 assert.match(query,/COALESCE\(payload->'inceptionHMinusOneWitness'->>'snapshotId', ''\) <> ''/);
 assert.match(query,/AND NOT EXISTS \(\s+SELECT 1\s+FROM referenced\s+WHERE referenced\.snapshot_id = snapshot\.snapshot_id\s+\)/);
});
