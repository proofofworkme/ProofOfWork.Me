import { PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../../src/shared/protocol/pay.mjs';
import * as bitcoin from 'bitcoinjs-lib';
import { codeTransactionFromRow } from './code-reader.mjs';
import { readMailWorkSettlementEvidence } from './mail-work-settlement-reader.mjs';
import { createPaySnapshot, paySnapshotRequest, payReadError, verifyPayTransaction, payCandidateEventClosure,
  PAY_DISCOVERY_MODEL, PAY_DISCOVERY_META_KEY, PAY_DISCOVERY_EMPTY_SHA256, advancePayCandidateDigest } from '../pay.mjs';

export async function readPayWorkSettlementEvidence(client, network, transactions) {
  return readMailWorkSettlementEvidence(client, network, transactions, {
    candidate: tx => { const event = verifyPayTransaction(tx); return event?.confirmed && event.valid && event.action === 'pay' && event.workTransfer; },
    verifyTransaction: verifyPayTransaction, evidenceKey: '_payWorkSettlementEvidence', readError: payReadError,
    label: 'Pay', unavailableCode: 'PAY_WORK_SETTLEMENT_UNAVAILABLE',
  });
}
/** Every confirmed Pay candidate remains closed over the accepted aggregate Mail record. */
export async function readPayMailEvidence(client, network, transactions) {
  const candidates = transactions.filter(tx => tx.status?.confirmed === true);
  if (!candidates.length) return;
  const native = await client.query(`/* pay_transition_storage_accessor */ SELECT
    to_regprocedure('proof_indexer.read_work_transition_payload_v1(text,integer,text,jsonb)') IS NOT NULL AS present`);
  const usesNative = native.rows[0]?.present === true;
  const payload = usesNative ? 'witness.payload' : 'transition.payload';
  const join = usesNative ? `LEFT JOIN LATERAL (
    SELECT proof_indexer.read_work_transition_payload_v1(transition.network,transition.block_height,transition.block_hash,transition.payload) AS payload
    WHERE transition.block_height IS NOT NULL OFFSET 0
  ) witness ON true` : '';
  const byTxid = new Map(candidates.map(tx => [tx.txid, tx]));
  for (const tx of candidates) tx._payMailEvidence = { rows: [], transition: null };
  const ids = [...byTxid.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await client.query(`/* pay_canonical_mail_closure */ SELECT e.*,
      jsonb_build_object('block_height',transition.block_height,'block_hash',transition.block_hash,
        'complete',transition.complete,'block_atomic',transition.block_atomic,'fee_once',transition.fee_once,'invalid_zero',transition.invalid_zero,
        'payload',jsonb_build_object('replayRecords',(SELECT jsonb_agg(record)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${payload}->'replayRecords')='array' THEN ${payload}->'replayRecords' ELSE '[]'::jsonb END) record
          WHERE record->>'txid'=e.txid))) AS transition
      FROM proof_indexer.events e JOIN proof_indexer.transactions tx ON tx.network=e.network AND tx.txid=e.txid AND tx.status='confirmed'
        AND tx.block_height=e.block_height AND tx.block_index=e.block_index
      JOIN proof_indexer.blocks block ON block.network=tx.network AND block.height=tx.block_height AND block.block_hash=tx.block_hash AND block.canonical=true
      LEFT JOIN proof_indexer.work_amo_block_transitions transition ON transition.network=tx.network AND transition.block_height=tx.block_height
        AND transition.block_hash=tx.block_hash AND transition.previous_block_hash=block.previous_block_hash
      ${join} WHERE e.network=$1 AND e.txid=ANY($2::text[]) AND e.protocol='pwm1'
      ORDER BY e.txid,e.op_return_vout,e.record_ordinal`, [network, ids.slice(offset, offset + 100)]);
    for (const row of result.rows) {
      const tx = byTxid.get(row.txid);
      if (!tx) throw payReadError('Pay Mail evidence names an unrequested transaction.');
      tx._payMailEvidence.rows.push(row); tx._payMailEvidence.transition = row.transition;
    }
  }
  for (const tx of candidates) {
    const event = verifyPayTransaction(tx), closure = tx._payMailEvidence, transition = closure.transition;
    if (!event || transition?.complete !== true || transition.block_atomic !== true || transition.fee_once !== true || transition.invalid_zero !== true ||
        !payCandidateEventClosure(tx, closure.rows, event, transition)) {
      throw payReadError('Pay canonical Mail evidence is unavailable.', 503, 'PAY_MAIL_EVIDENCE_UNAVAILABLE');
    }
  }
}
async function readPayReferences(transactions, { verifyReference, checkpointHeight, checkpointHash }) {
  const verified = new Map();
  for (const tx of transactions) {
    const event = verifyPayTransaction(tx);
    if (!event?.confirmed || !event.valid || event.action !== 'invoice' || !event.metadata.reference) continue;
    if (typeof verifyReference !== 'function') throw payReadError('Invoice reference verification is unavailable.', 503, 'PAY_REFERENCE_UNAVAILABLE');
    if (!verified.has(event.metadata.reference)) verified.set(event.metadata.reference,
      await verifyReference({ txid: event.metadata.reference, checkpointHeight, checkpointHash }));
    tx._payReferenceEvidence = verified.get(event.metadata.reference);
  }
}

/** Complete cold discovery is separate from this indexed public read. */
export async function readPaySnapshot(client, network, params, { verifyCheckpoint, verifyReference } = {}) {
  if (network !== 'livenet' || PAY_ACTIVATION_HEIGHT < 1 || !/^[0-9a-f]{64}$/u.test(PAY_ACTIVATION_PREVIOUS_BLOCK_HASH)) throw payReadError('Pay activation is not configured.', 503, 'PAY_ACTIVATION_DISABLED');
  const { snapshot: requested } = paySnapshotRequest(params, network);
  const markerResult = await client.query('SELECT value FROM proof_indexer.meta WHERE key=$1', [PAY_DISCOVERY_META_KEY]);
  const observedMarker = markerResult.rows[0]?.value;
  const marker = observedMarker?.complete === true ? observedMarker : observedMarker?.lastGood;
  if (marker?.model !== PAY_DISCOVERY_MODEL || marker?.network !== network || marker?.complete !== true ||
      marker?.fromHeight !== PAY_ACTIVATION_HEIGHT || !Number.isSafeInteger(marker.indexedThroughBlock) || marker.indexedThroughBlock < PAY_ACTIVATION_HEIGHT - 1 ||
      !/^[0-9a-f]{64}$/u.test(marker.indexedThroughBlockHash) || !/^[0-9a-f]{64}$/u.test(marker.candidateSha256) || !Number.isSafeInteger(marker.candidateCount) || marker.candidateCount < 0 ||
      (marker.indexedThroughBlock === PAY_ACTIVATION_HEIGHT - 1 && (marker.indexedThroughBlockHash !== PAY_ACTIVATION_PREVIOUS_BLOCK_HASH || marker.candidateCount !== 0 || marker.candidateSha256 !== PAY_DISCOVERY_EMPTY_SHA256))) {
    throw payReadError('Historical Pay candidate discovery is incomplete; run the supervised Pay bootstrap before opening reads.', 503, 'PAY_DISCOVERY_INCOMPLETE');
  }
  if (typeof verifyCheckpoint !== 'function' || await verifyCheckpoint(PAY_ACTIVATION_HEIGHT - 1) !== PAY_ACTIVATION_PREVIOUS_BLOCK_HASH) {
    throw payReadError('Pay activation parent differs from its pinned canonical block.', 503, 'PAY_ACTIVATION_ORPHANED');
  }
  const checkpointHeight = requested?.checkpointHeight ?? marker.indexedThroughBlock;
  const checkpointHash = requested?.checkpointHash ?? marker.indexedThroughBlockHash;
  if (checkpointHeight < PAY_ACTIVATION_HEIGHT - 1) throw payReadError('Pay snapshot precedes the first-admission boundary parent.', 400, 'PAY_SNAPSHOT_BEFORE_ACTIVATION');
  if (checkpointHeight > marker.indexedThroughBlock) throw payReadError('Pay snapshot exceeds verified discovery coverage.');
  const blocks = await client.query(`SELECT height,block_hash FROM proof_indexer.blocks
    WHERE network=$1 AND canonical=true AND height=ANY($2::integer[])`, [network, [checkpointHeight, marker.indexedThroughBlock]]);
  if (!blocks.rows.some(row => Number(row.height) === checkpointHeight && row.block_hash === checkpointHash) ||
      !blocks.rows.some(row => Number(row.height) === marker.indexedThroughBlock && row.block_hash === marker.indexedThroughBlockHash)) {
    throw payReadError('Pay checkpoint was reorganized; restart the repository read.', 409, 'PAY_CHECKPOINT_REORG');
  }
  if (typeof verifyCheckpoint !== 'function' || await verifyCheckpoint(checkpointHeight) !== checkpointHash ||
      (checkpointHeight !== marker.indexedThroughBlock && await verifyCheckpoint(marker.indexedThroughBlock) !== marker.indexedThroughBlockHash)) {
    throw payReadError('Pay checkpoint cannot be verified against the canonical node.');
  }
  const closure = await client.query(`SELECT count(*)::text AS count FROM proof_indexer.transactions t
    JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash AND b.height=t.block_height AND b.canonical=true
    WHERE t.network=$1 AND t.status='confirmed' AND t.block_height<=$2 AND t.block_height>=$3 AND EXISTS
      (SELECT 1 FROM proof_indexer.op_returns o WHERE o.network=t.network AND o.txid=t.txid AND o.protocol='pwm1' AND o.payload_hex LIKE '70776d313a6d3a7077706179313a%')`, [network, marker.indexedThroughBlock, PAY_ACTIVATION_HEIGHT]);
  if (String(marker.candidateCount) !== closure.rows[0]?.count) throw payReadError('Pay candidate corpus differs from its complete discovery witness.');
  const candidateQuery = `SELECT t.*,
    (SELECT jsonb_agg(jsonb_build_object('vout',o.vout,'value_sats',o.value_sats::text,'scriptpubkey',o.scriptpubkey) ORDER BY o.vout)
      FROM proof_indexer.tx_outputs o WHERE o.network=t.network AND o.txid=t.txid) AS outputs
    FROM proof_indexer.transactions t LEFT JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash
    WHERE t.network=$1 AND ((t.status='confirmed' AND t.block_height<=$2 AND t.block_height>=$3 AND b.canonical=true AND b.height=t.block_height AND t.block_index>=0)
      OR t.status='pending') AND EXISTS
      (SELECT 1 FROM proof_indexer.op_returns o WHERE o.network=t.network AND o.txid=t.txid AND o.protocol='pwm1' AND o.payload_hex LIKE '70776d313a6d3a7077706179313a%')
    ORDER BY CASE WHEN t.status='confirmed' THEN 0 ELSE 1 END,t.block_height,t.block_index,t.txid LIMIT 128 OFFSET $4`;
  const result = { rows: [] }; let sourceBytes = 0;
  for (let offset = 0; ; offset += 128) {
    const page = await client.query(candidateQuery, [network, marker.indexedThroughBlock, PAY_ACTIVATION_HEIGHT, offset]);
    sourceBytes += Buffer.byteLength(JSON.stringify(page.rows));
    if (result.rows.length + page.rows.length > 50000 || sourceBytes > 64 * 1024 * 1024) {
      throw payReadError('Pay candidate corpus exceeds its bounded read; complete evidence cannot be asserted.');
    }
    result.rows.push(...page.rows);
    if (page.rows.length < 128) break;
  }
  const transactions = [], pendingWarnings = [];
  for (const row of result.rows) {
    try {
      const normalized = codeTransactionFromRow(row, network);
      // codeTransactionFromRow has proved raw.hex commits to the indexed TXID,
      // exact inputs and outputs. Signature hashes must use that same header,
      // never a missing or stale duplicate JSON version/locktime projection.
      const header = typeof row.raw_tx.hex === 'string' && row.raw_tx.hex
        ? bitcoin.Transaction.fromHex(row.raw_tx.hex) : row.raw_tx;
      transactions.push({ ...normalized, version: header.version, locktime: header.locktime });
    }
    catch (error) {
      if (row.status === 'confirmed') throw error;
      pendingWarnings.push({ txid: row.txid, reason: 'pending-raw-evidence-unavailable' });
    }
  }
  const digest = transactions.filter(tx => tx.status.confirmed).reduce(advancePayCandidateDigest, PAY_DISCOVERY_EMPTY_SHA256);
  if (digest !== marker.candidateSha256) throw payReadError('Pay raw candidate corpus differs from its complete discovery commitment.');
  const selected = transactions.filter(tx => !tx.status.confirmed || tx.status.block_height <= checkpointHeight);
  await readPayMailEvidence(client, network, selected);
  await readPayWorkSettlementEvidence(client, network, selected);
  await readPayReferences(selected, { verifyReference, checkpointHeight, checkpointHash });
  return { ...createPaySnapshot({ network, checkpointHeight, checkpointHash,
    transactions: selected, generatedAt: marker.generatedAt
    }), pendingWarnings };
}
