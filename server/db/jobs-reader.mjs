import { JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../src/shared/protocol/jobs.mjs";
import { codeTransactionFromRow } from './code-reader.mjs';
import { createJobsSnapshot, jobsSnapshotRequest, jobsReadError, JOBS_DISCOVERY_MODEL, JOBS_DISCOVERY_META_KEY, JOBS_DISCOVERY_EMPTY_SHA256, advanceJobsCandidateDigest } from '../jobs.mjs';

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
  return { ...createJobsSnapshot({ network, checkpointHeight, checkpointHash,
    transactions: transactions.filter(tx => !tx.status.confirmed || tx.status.block_height <= checkpointHeight), generatedAt: marker.generatedAt
    }), pendingWarnings };
}
