/** Read-only binding to already accepted WORK replay, including native witness storage.
 * Raw send3 text alone never establishes an available balance or settlement. */
export async function readMailWorkSettlementEvidence(client, network, transactions, { candidate, verifyTransaction, evidenceKey, readError, label, unavailableCode }) {
  const candidates = transactions.filter(candidate);
  if (!candidates.length) return;
  const native = await client.query(`/* jobs_transition_storage_accessor */ SELECT
    to_regprocedure('proof_indexer.read_work_transition_payload_v1(text,integer,text,jsonb)') IS NOT NULL AS present`);
  const usesNativeWitness = native.rows[0]?.present === true;
  const transitionPayload = usesNativeWitness ? 'witness.payload' : 'transition.payload';
  const nativeWitnessJoin = usesNativeWitness ? `LEFT JOIN LATERAL (
    SELECT proof_indexer.read_work_transition_payload_v1(transition.network,transition.block_height,transition.block_hash,transition.payload) AS payload
    WHERE transition.block_height IS NOT NULL OFFSET 0
  ) witness ON true` : '';
  const byTxid = new Map(candidates.map(tx => [tx.txid, tx]));
  for (const tx of candidates) tx[evidenceKey] = [];
  const ids = [...byTxid.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await client.query(`/* jobs_canonical_work_settlement */
      SELECT e.*,tx.block_hash,
        (SELECT jsonb_agg(jsonb_build_object('txid',mail.txid,'protocol',mail.protocol,'status',mail.status,
          'block_height',mail.block_height,'block_index',mail.block_index,'op_return_vout',mail.op_return_vout,
          'record_ordinal',mail.record_ordinal,'raw_payload',mail.raw_payload,'valid',mail.valid,'payload',mail.payload))
          FROM proof_indexer.events mail WHERE mail.network=e.network AND mail.txid=e.txid AND mail.protocol='pwm1') AS "mailEvents",
        jsonb_build_object('block_height',transition.block_height,'block_hash',transition.block_hash,'model',transition.model,
          'state_commitment_model',transition.state_commitment_model,'event_set_model',transition.event_set_model,
          'complete',transition.complete,'block_atomic',transition.block_atomic,'fee_once',transition.fee_once,'invalid_zero',transition.invalid_zero,
          'payload',jsonb_build_object('transitionChainModel',${transitionPayload}->'transitionChainModel',
            'transitionChainCommitment',${transitionPayload}->'transitionChainCommitment',
            'replayRecords',(SELECT jsonb_agg(record) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${transitionPayload}->'replayRecords')='array'
              THEN ${transitionPayload}->'replayRecords' ELSE '[]'::jsonb END) record WHERE record->>'txid'=e.txid),
            'traces',(SELECT jsonb_agg(trace) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${transitionPayload}->'traces')='array'
              THEN ${transitionPayload}->'traces' ELSE '[]'::jsonb END) trace WHERE trace->>'txid'=e.txid))) AS transition
      FROM proof_indexer.events e JOIN proof_indexer.transactions tx ON tx.network=e.network AND tx.txid=e.txid AND tx.status='confirmed'
        AND tx.block_height=e.block_height AND tx.block_index=e.block_index
      JOIN proof_indexer.blocks block ON block.network=tx.network AND block.height=tx.block_height AND block.block_hash=tx.block_hash AND block.canonical=true
      LEFT JOIN proof_indexer.work_amo_block_transitions transition ON transition.network=tx.network AND transition.block_height=tx.block_height
        AND transition.block_hash=tx.block_hash AND transition.previous_block_hash=block.previous_block_hash
      ${nativeWitnessJoin}
      WHERE e.network=$1 AND e.txid=ANY($2::text[]) AND e.protocol='pwt1' ORDER BY e.txid,e.op_return_vout,e.record_ordinal`, [network, ids.slice(offset, offset + 100)]);
    for (const evidence of result.rows) {
      const tx = byTxid.get(evidence.txid);
      if (!tx) throw readError(`${label} WORK evidence names an unrequested transaction.`);
      tx[evidenceKey].push(evidence);
    }
  }
  for (const tx of candidates) {
    const evidence = tx[evidenceKey];
    const transition = evidence.length === 1 ? evidence[0].transition : null;
    const event = verifyTransaction(tx);
    const position = { blockHeight: event.blockHeight, blockHash: event.blockHash,
      blockTransactionIndex: event.blockTransactionIndex, protocolVout: event.workTransfer.protocolVout, recordOrdinal: 0 };
    const atTransferPosition = value => value && Object.keys(position).every(key => value[key] === position[key]);
    const witnesses = Array.isArray(transition?.payload?.replayRecords) ? transition.payload.replayRecords.filter(item =>
      item?.txid === tx.txid && item.protocol === 'pwt1' && atTransferPosition(item.position)) : [];
    const traces = Array.isArray(transition?.payload?.traces) ? transition.payload.traces.filter(item =>
      item?.txid === tx.txid && item.kind === 'protocol-record' && atTransferPosition(item.position)) : [];
    const hasRawParts = value => Array.isArray(value?.rawRecordParts) && value.rawRecordParts.length > 0;
    // A complete invalid replay is rejection evidence. An absent PWT source or
    // trace is unavailable evidence, even when this transaction has PWM entries.
    if (evidence.length !== 1 || evidence[0].status !== 'confirmed' || transition?.complete !== true ||
        transition.block_atomic !== true || transition.fee_once !== true || transition.invalid_zero !== true ||
        witnesses.length !== 1 || witnesses[0].rawCandidate !== true || typeof witnesses[0].outcome?.valid !== 'boolean' ||
        !hasRawParts(witnesses[0].rawWitness) || traces.length !== 1 || typeof traces[0].valid !== 'boolean' ||
        !hasRawParts(traces[0].rawWitness)) {
      throw readError(`${label} WORK settlement canonical evidence is unavailable; an unpaid total cannot be asserted.`, 503, unavailableCode);
    }
  }
}
