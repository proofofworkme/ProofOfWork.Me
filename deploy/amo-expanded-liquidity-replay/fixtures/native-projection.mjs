import assert from "node:assert/strict";
import { expandedBatchFamilies, expandedBatchFamiliesSql } from "../../../server/db/expanded-batch-parent.mjs";
import { GOVERNED_RELATIONAL_BINDINGS_SQL } from "../relations.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "../../../server/work-amo-v5.mjs";
import { replayEventSetCommitment } from "../records.mjs";
import { sha256 } from "../storage.mjs";
import { verifyReplayDeclaration } from "../qualify.mjs";
import { declarationEvidence, nativeRow, scenario } from "./replay.mjs";

// Relational storage fixture only. The raw-engine tests separately authenticate
// accepted batch events. These modeled frames exercise today's and a later
// empty block's cumulative native projection without a wallet or live chain.
export async function nativeProjectionCarry(client, {readRow, publication}) {
  const {rows,options:{tip,sources}} = scenario();
  const declaration = verifyReplayDeclaration(declarationEvidence);
  const txid = sha256("modeled WORK batch");
  const h = 977230;
  const position = {blockHeight:h,blockHash:rows.get(h).block_hash,blockTransactionIndex:1,protocolVout:0,recordOrdinal:0};
  const childPosition = {...position,recordOrdinal:1};
  const witness = label => ({model:"canonical-work-amo-raw-transition-chain-sha256-v1",sha256:sha256(label),payloadBytes:1234});
  const projected = p => ({txid,blockHash:p.blockHash,blockHeight:p.blockHeight,blockIndex:p.blockTransactionIndex,
    protocolVout:p.protocolVout,recordOrdinal:p.recordOrdinal,amountSubatoms:"10000000000000000"});
  function replay(tag) {
    const parentWitness = witness(tag+" parent");
    const derivedId = [txid,h,1,0,1].join(":");
    const descriptor = {kind:"token-transfer",derivedId,derivedIndex:0,rawCandidate:false,economicDelta:false,chargesTransactionFee:false,
      claimsEconomicOutputs:false,containerPosition:position,projectionPosition:childPosition,parentTransitionChainCommitmentAfter:parentWitness};
    const base = {protocol:"pwt1",txid,transactionMinerFeeSats:"1",transactionProtocolRecordCount:2,stateDelta:{}};
    const parent = {...base,position,derived:[descriptor],rawCandidate:true,rawWitness:{},output:{},
      outcome:{kind:"token-event",semanticKind:"token-transfer-batch",valid:true},transitionChainCommitmentAfter:parentWitness};
    const child = {...base,position:childPosition,derived:true,rawCandidate:false,chargesTransactionFee:false,parentPosition:position,
      rawWitness:{model:"canonical-work-amo-v5-derived-child-v1",parentPosition:position,parentProtocol:"pwt1",descriptor},
      output:{projection:{...descriptor}},outcome:{kind:"token-event",semanticKind:"token-transfer",valid:true},
      parentTransitionChainCommitmentAfter:parentWitness};
    const mail = {...base,protocol:"pwm1",position:{...position,protocolVout:1},derived:[],rawCandidate:true,rawWitness:{},output:{},
      outcome:{kind:"message",semanticKind:"mail",valid:true},transitionChainCommitmentAfter:witness(tag+" mail")};
    const replayRecords = [parent,child,mail];
    return {replayRecords,replayDescriptorCommitment:workAmoV5CanonicalPayloadCommitment(replayRecords),eventSetCommitment:replayEventSetCommitment(replayRecords),
      traces:[{kind:"protocol-record",position,txid,transitionChainCommitmentAfter:parentWitness},
        {kind:"protocol-record",position:mail.position,txid,transitionChainCommitmentAfter:mail.transitionChainCommitmentAfter},
        {kind:"transaction-fee",txid,transitionChainCommitmentAfter:witness(tag+" fee")}],
      closingWorkProjection:{transferBatches:[{...projected(position),transitionChainCommitmentAfter:parentWitness}],
        transfers:[{...projected(childPosition),derivedId,parentTransitionChainCommitmentAfter:parentWitness}]}};
  }
  const old = replay("old");
  const next = replay("rebound");
  const q = {declaration,tip,sourceBinding:sources.binding,blocks:[]};
  const originals = new Map();
  for (const [height,row] of rows)
    await client.query("INSERT INTO proof_indexer.blocks(network,height,block_hash,previous_block_hash) VALUES ('livenet',$1,$2,$3)",
      [height,row.block_hash,row.previous_block_hash]);
  const transaction = {txid,vout:[{n:0},{n:1}]};
  await client.query(`INSERT INTO proof_indexer.transactions(network,txid,status,block_hash,block_height,block_index,fee_sats,raw_tx)
    VALUES('livenet',$1,'confirmed',$2,$3,1,1,$4)`,[txid,position.blockHash,h,JSON.stringify(transaction)]);
  let parentId;
  for (const record of old.replayRecords) {
    const {position:p,protocol,outcome} = record;
    if (record.rawCandidate) {
      await client.query("INSERT INTO proof_indexer.tx_outputs(network,txid,vout) VALUES('livenet',$1,$2)",[txid,p.protocolVout]);
      await client.query("INSERT INTO proof_indexer.op_returns(network,txid,vout,output_index,protocol) VALUES('livenet',$1,$2,0,$3)",
        [txid,p.protocolVout,protocol]);
    }
    const payload = {txid,position:p,...(record.rawCandidate ? {transitionChainCommitmentAfter:record.transitionChainCommitmentAfter}
      : {derivedId:record.rawWitness.descriptor.derivedId})};
    const inserted = await client.query(`INSERT INTO proof_indexer.events(network,event_key,txid,op_return_vout,record_ordinal,
      protocol,kind,status,valid,block_height,block_index,payload) VALUES('livenet',$1,$2,$3,$4,$5,$6,'confirmed',true,$7,1,$8)
      RETURNING event_id::text AS id`,[[txid,p.protocolVout,p.recordOrdinal].join(":"),txid,p.protocolVout,
      p.recordOrdinal,protocol,outcome.semanticKind,h,JSON.stringify(payload)]);
    if (outcome.semanticKind==="token-transfer-batch") parentId=inserted.rows[0].id;
  }
  for (const height of [h,h+1]) {
    const isBatch = height===h;
    const frame = {...rows.get(height).decoded,...(isBatch?old:{closingWorkProjection:old.closingWorkProjection}),
      ...(isBatch?{protocolRecordCount:2,rawProtocolCandidateCount:2,transactionCount:1,eventCount:3}:{})};
    const row = nativeRow(frame);
    await client.query("INSERT INTO proof_indexer.work_amo_block_transitions SELECT (jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,$1::jsonb)).*",
      [JSON.stringify({...row,payload:frame,created_at:"2026-11-22T15:00:00Z"})]);
    const stored = await readRow(client,height);
    const replacementFields = {...(isBatch?next:{closingWorkProjection:next.closingWorkProjection}),expandedLiquidity:declaration,
      transitionChainCommitment:{...frame.transitionChainCommitment,sha256:sha256("block close "+height)}};
    q.blocks.push({height,hash:row.block_hash,previousBlockHash:row.previous_block_hash,currentMainRowSha256:stored.current_main_row_sha256,
      oldNativeSha256:stored.native_sha256,oldNativeBytes:stored.native_bytes,oldTransitionChainCommitment:frame.transitionChainCommitment,
      oldEventSetCommitment:frame.eventSetCommitment,newEventSetCommitment:isBatch?next.eventSetCommitment:frame.eventSetCommitment,
      protocolCounts:{protocolRecordCount:row.protocol_record_count,rawProtocolCandidateCount:row.raw_protocol_candidate_count,
        transactionCount:row.transaction_count,eventCount:row.event_count},replacementFields,
      relationalBindings:(await client.query(GOVERNED_RELATIONAL_BINDINGS_SQL,[height,row.block_hash])).rows[0]});
    originals.set(height,frame);
  }
  await client.query("CREATE TEMP TABLE expanded_replay_input(qualification jsonb,qualification_sha text,manifest_sha text) ON COMMIT DROP");
  const submit = async input => {
    for (const b of input.blocks) {
      const corrected = {...originals.get(b.height),...b.replacementFields};
      const {rows:[d]} = await client.query("SELECT encode(sha256(jsonb_send($1::jsonb)),'hex') AS sha,octet_length(jsonb_send($1::jsonb)) AS bytes",
        [JSON.stringify(corrected)]);
      Object.assign(b,{newNativeSha256:d.sha,newNativeBytes:d.bytes});
    }
    const text = JSON.stringify(input);
    await client.query("INSERT INTO pg_temp.expanded_replay_input VALUES ($1::jsonb,$2,$3)",[text,sha256(text),sha256("native fixture")]);
    await client.query(publication);
  };
  for (const [height,mutate,reason] of [
    [h,p=>{p.transfers[0].derivedId="detached";},/projection economics or position/],
    [h,p=>{p.transferBatches[0].transitionChainCommitmentAfter.sha256=sha256("other");},/not bound to its event/],
    [h+1,p=>{p.transfers[0].parentTransitionChainCommitmentAfter.sha256=sha256("other");},/does not carry prior qualified provenance/],
  ]) {
    await client.query("SAVEPOINT disputed_projection");
    const altered = JSON.parse(JSON.stringify(q));
    mutate(altered.blocks.find(b=>b.height===height).replacementFields.closingWorkProjection);
    await assert.rejects(submit(altered),reason,String(reason));
    await client.query("ROLLBACK TO disputed_projection");
  }
  await submit(q);
  for (const height of [h,h+1]) assert.deepEqual((await readRow(client,height)).decoded.closingWorkProjection,next.closingWorkProjection);
  const selected=await readRow(client,h), family={id:parentId,txid,index:1,vout:0};
  const args=["livenet",h,position.blockHash,selected.native_sha256,JSON.stringify(declaration),JSON.stringify([family])];
  await client.query("SET LOCAL ROLE fixture_api");
  try {
    const {rows:[row]} = await client.query(expandedBatchFamiliesSql,args);
    assert.ok(row?.resealed);
    assert.equal(row.parent_event_id,parentId);
    assert.deepEqual(row.selected_records,next.replayRecords.filter(r=>r.rawCandidate));
    assert.deepEqual(row.archived_records,old.replayRecords.filter(r=>r.rawCandidate));
    assert.deepEqual(row.transaction,transaction);
    assert.deepEqual(row.carrier_output,transaction.vout[0]);
    assert.deepEqual(row.siblings.map(r=>r.position),[{blockHeight:h,blockTransactionIndex:1,protocolVout:0,recordOrdinal:1}]);
    const [accepted]=await expandedBatchFamilies(client,"livenet",[{parent_event_id:parentId,selected_family:family,
      selected_height:h,selected_hash:position.blockHash,selected_storage:selected.storage_commitment,expanded_declaration:declaration}]);
    assert.deepEqual(accepted.parent_records,[old.replayRecords[0]]);
    assert.deepEqual(accepted.mail_records,[old.replayRecords[2]]);
    const wrong=[...args];
    wrong[3]=sha256("wrong selected native frame");
    assert.deepEqual((await client.query(expandedBatchFamiliesSql,wrong)).rows,[]);
  } finally { await client.query("RESET ROLE"); }
  await client.query("SAVEPOINT changed_terminal");
  await client.query("UPDATE proof_indexer.blocks SET canonical=false WHERE network='livenet' AND height=$1",[tip.height]);
  assert.deepEqual((await client.query(expandedBatchFamiliesSql,args)).rows,[]);
  await client.query("ROLLBACK TO changed_terminal");
}
