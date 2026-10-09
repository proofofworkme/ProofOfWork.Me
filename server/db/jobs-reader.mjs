import { JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH, JOBS_V2_ACTIVATION_HEIGHT,
  JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../src/shared/protocol/jobs.mjs";
import { codeTransactionFromRow } from './code-reader.mjs';
import { createJobsSnapshot, jobsSnapshotRequest, jobsReadError, verifyJobsTransaction, JOBS_DISCOVERY_MODEL, JOBS_DISCOVERY_META_KEY, JOBS_DISCOVERY_EMPTY_SHA256, advanceJobsCandidateDigest } from '../jobs.mjs';

/** Read-only binding to already accepted WORK replay, including native witness storage.
 * Raw send3 text alone never establishes an available balance or settlement. */
export async function readJobsWorkSettlementEvidence(client, network, transactions) {
  const candidates = transactions.filter(tx => {
    const event = verifyJobsTransaction(tx);
    return event?.confirmed && event.valid && event.metadata?.v === 2 && event.action === 'accept' && event.workTransfer;
  });
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
  for (const tx of candidates) tx._jobsWorkSettlementEvidence = [];
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
      if (!tx) throw jobsReadError('Jobs WORK evidence names an unrequested transaction.');
      tx._jobsWorkSettlementEvidence.push(evidence);
    }
  }
  for (const tx of candidates) {
    const evidence = tx._jobsWorkSettlementEvidence;
    const transition = evidence.length === 1 ? evidence[0].transition : null;
    const event = verifyJobsTransaction(tx);
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
      throw jobsReadError('Jobs WORK settlement canonical evidence is unavailable; an unpaid total cannot be asserted.', 503, 'JOBS_WORK_SETTLEMENT_UNAVAILABLE');
    }
  }
}

/** Complete cold discovery is separate from this indexed public read. */
export async function readJobsSnapshot(client, network, params, { verifyCheckpoint } = {}) {
  const { snapshot: requested } = jobsSnapshotRequest(params, network);
  const markerResult = await client.query('SELECT value FROM proof_indexer.meta WHERE key=$1', [JOBS_DISCOVERY_META_KEY]);
  const observedMarker = markerResult.rows[0]?.value;
  const marker = observedMarker?.complete === true ? observedMarker : observedMarker?.lastGood;
  if (marker?.model !== JOBS_DISCOVERY_MODEL || marker?.network !== network || marker?.complete !== true ||
      marker?.fromHeight !== JOBS_ACTIVATION_HEIGHT || !Number.isSafeInteger(marker.indexedThroughBlock) || marker.indexedThroughBlock < JOBS_ACTIVATION_HEIGHT - 1 ||
      !/^[0-9a-f]{64}$/u.test(marker.indexedThroughBlockHash) || !/^[0-9a-f]{64}$/u.test(marker.candidateSha256) || !Number.isSafeInteger(marker.candidateCount) || marker.candidateCount < 0 ||
      (marker.indexedThroughBlock === JOBS_ACTIVATION_HEIGHT - 1 && (marker.indexedThroughBlockHash !== JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH || marker.candidateCount !== 0 || marker.candidateSha256 !== JOBS_DISCOVERY_EMPTY_SHA256))) {
    throw jobsReadError('Historical Jobs candidate discovery is incomplete; run the supervised Jobs bootstrap before opening reads.', 503, 'JOBS_DISCOVERY_INCOMPLETE');
  }
  if (typeof verifyCheckpoint !== 'function' || await verifyCheckpoint(JOBS_ACTIVATION_HEIGHT - 1) !== JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH) {
    throw jobsReadError('Jobs activation parent differs from its pinned canonical block.', 503, 'JOBS_ACTIVATION_ORPHANED');
  }
  const checkpointHeight = requested?.checkpointHeight ?? marker.indexedThroughBlock;
  const checkpointHash = requested?.checkpointHash ?? marker.indexedThroughBlockHash;
  if (checkpointHeight < JOBS_ACTIVATION_HEIGHT - 1) throw jobsReadError('Jobs snapshot precedes the first-admission boundary parent.', 400, 'JOBS_SNAPSHOT_BEFORE_ACTIVATION');
  if (checkpointHeight > marker.indexedThroughBlock) throw jobsReadError('Jobs snapshot exceeds verified discovery coverage.');
  const blocks = await client.query(`SELECT height,block_hash FROM proof_indexer.blocks
    WHERE network=$1 AND canonical=true AND height=ANY($2::integer[])`, [network, [checkpointHeight, marker.indexedThroughBlock]]);
  if (!blocks.rows.some(row => Number(row.height) === checkpointHeight && row.block_hash === checkpointHash) ||
      !blocks.rows.some(row => Number(row.height) === marker.indexedThroughBlock && row.block_hash === marker.indexedThroughBlockHash)) {
    throw jobsReadError('Jobs checkpoint was reorganized; restart the repository read.', 409, 'JOBS_CHECKPOINT_REORG');
  }
  if (typeof verifyCheckpoint !== 'function' || await verifyCheckpoint(checkpointHeight) !== checkpointHash ||
      (checkpointHeight !== marker.indexedThroughBlock && await verifyCheckpoint(marker.indexedThroughBlock) !== marker.indexedThroughBlockHash)) {
    throw jobsReadError('Jobs checkpoint cannot be verified against the canonical node.');
  }
  let v2Ready = false;
  if (checkpointHeight >= JOBS_V2_ACTIVATION_HEIGHT - 1) {
    const parent = await client.query(`/* jobs_v2_activation_parent */ SELECT block_hash FROM proof_indexer.blocks
      WHERE network=$1 AND canonical=true AND height=$2 ORDER BY block_hash LIMIT 2`, [network, JOBS_V2_ACTIVATION_HEIGHT - 1]);
    if (parent.rows.length !== 1 || parent.rows[0].block_hash !== JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH ||
        await verifyCheckpoint(JOBS_V2_ACTIVATION_HEIGHT - 1) !== JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH) {
      throw jobsReadError('Jobs version-two activation parent differs from its pinned canonical block.', 503, 'JOBS_V2_ACTIVATION_ORPHANED');
    }
    v2Ready = true;
  }
  const closure = await client.query(`SELECT count(*)::text AS count FROM proof_indexer.transactions t
    JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash AND b.height=t.block_height AND b.canonical=true
    WHERE t.network=$1 AND t.status='confirmed' AND t.block_height<=$2 AND t.block_height>=$3 AND EXISTS
      (SELECT 1 FROM proof_indexer.op_returns o WHERE o.network=t.network AND o.txid=t.txid AND o.protocol='pwm1' AND o.payload_hex LIKE '70776d313a6d3a70776a313a%')`, [network, marker.indexedThroughBlock, JOBS_ACTIVATION_HEIGHT]);
  if (String(marker.candidateCount) !== closure.rows[0]?.count) throw jobsReadError('Jobs candidate corpus differs from its complete discovery witness.');
  const result = await client.query(`SELECT t.*,
    (SELECT jsonb_agg(jsonb_build_object('vout',o.vout,'value_sats',o.value_sats::text,'scriptpubkey',o.scriptpubkey) ORDER BY o.vout)
      FROM proof_indexer.tx_outputs o WHERE o.network=t.network AND o.txid=t.txid) AS outputs
    FROM proof_indexer.transactions t LEFT JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash
    WHERE t.network=$1 AND ((t.status='confirmed' AND t.block_height<=$2 AND t.block_height>=$3 AND b.canonical=true AND b.height=t.block_height AND t.block_index>=0)
      OR t.status='pending') AND EXISTS
      (SELECT 1 FROM proof_indexer.op_returns o WHERE o.network=t.network AND o.txid=t.txid AND o.protocol='pwm1' AND o.payload_hex LIKE '70776d313a6d3a70776a313a%')
    ORDER BY CASE WHEN t.status='confirmed' THEN 0 ELSE 1 END,t.block_height,t.block_index,t.txid`, [network, marker.indexedThroughBlock, JOBS_ACTIVATION_HEIGHT]);
  const transactions = [], pendingWarnings = [];
  for (const row of result.rows) {
    try { transactions.push(codeTransactionFromRow(row, network)); }
    catch (error) {
      if (row.status === 'confirmed') throw error;
      pendingWarnings.push({ txid: row.txid, reason: 'pending-raw-evidence-unavailable' });
    }
  }
  const digest = transactions.filter(tx => tx.status.confirmed).reduce(advanceJobsCandidateDigest, JOBS_DISCOVERY_EMPTY_SHA256);
  if (digest !== marker.candidateSha256) throw jobsReadError('Jobs raw candidate corpus differs from its complete discovery commitment.');
  const selected = transactions.filter(tx => !tx.status.confirmed || tx.status.block_height <= checkpointHeight);
  await readJobsWorkSettlementEvidence(client, network, selected);
  return { ...createJobsSnapshot({ network, checkpointHeight, checkpointHash,
    transactions: selected, generatedAt: marker.generatedAt, v2Ready
    }), pendingWarnings };
}
