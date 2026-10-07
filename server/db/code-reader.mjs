import * as bitcoin from 'bitcoinjs-lib';
import { createCodeSnapshot, codeSnapshotRequest, codeReadError, CODE_DISCOVERY_MODEL, CODE_DISCOVERY_META_KEY, CODE_DISCOVERY_EMPTY_SHA256, advanceCodeCandidateDigest, exactCodeOutputProofs } from '../code-repositories.mjs';

function addressFromScript(hex, network) {
  try { return bitcoin.address.fromOutputScript(Buffer.from(hex, 'hex'), network === 'livenet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet); }
  catch { return ''; }
}
function normalizeOutput(output, network) {
  const scriptpubkey = output?.scriptpubkey ?? output?.scriptPubKey?.hex ?? output?.scriptPubKeyHex ?? '';
  const value = exactCodeOutputProofs(output);
  if (value === null) {
    throw codeReadError('Code raw transaction contains an inexact proof quantity.');
  }
  return { value, scriptpubkey, scriptpubkey_address: addressFromScript(scriptpubkey, network) };
}
export function codeTransactionFromRow(row, network) {
  const raw = row.raw_tx;
  if (!raw || !Array.isArray(raw.vout) || !Array.isArray(raw.vin)) throw codeReadError('Code transaction raw evidence is unavailable.');
  const outputs = Array.isArray(row.outputs) ? row.outputs : [];
  const normalized = raw.vout.map(output => normalizeOutput(output, network));
  if (outputs.length !== normalized.length || outputs.some((output, index) =>
    Number(output.vout) !== index || output.scriptpubkey !== normalized[index].scriptpubkey ||
    String(output.value_sats) !== String(normalized[index].value))) throw codeReadError('Code output evidence differs from the canonical transaction.');
  const vin = raw.vin.map(input => ({ ...input,
    ...(input.prevout ? { prevout: normalizeOutput(input.prevout, network) } : {}) }));
  try {
    let serialized;
    if (typeof raw.hex === 'string' && raw.hex) serialized = bitcoin.Transaction.fromHex(raw.hex);
    else {
      serialized = new bitcoin.Transaction();
      if (!Number.isInteger(raw.version) || !Number.isSafeInteger(raw.locktime)) throw new Error('header');
      serialized.version = raw.version; serialized.locktime = raw.locktime;
      for (const input of raw.vin) {
        if (typeof input.coinbase === 'string') {
          serialized.addInput(Buffer.alloc(32), 0xffffffff, input.sequence, Buffer.from(input.coinbase, 'hex'));
          continue;
        }
        if (!/^[0-9a-f]{64}$/u.test(input.txid ?? '') || !Number.isSafeInteger(input.vout) || !Number.isSafeInteger(input.sequence)) throw new Error('input');
        serialized.addInput(Buffer.from(input.txid, 'hex').reverse(), input.vout, input.sequence,
          Buffer.from(input.scriptSig?.hex ?? input.scriptsig ?? '', 'hex'));
      }
      for (const output of normalized) serialized.addOutput(Buffer.from(output.scriptpubkey, 'hex'), BigInt(output.value));
    }
    if (serialized.getId() !== row.txid || serialized.ins.length !== raw.vin.length ||
        serialized.ins.some((input, index) => {
          const declared = raw.vin[index];
          return typeof declared.coinbase === 'string'
            ? input.index !== 0xffffffff || Buffer.from(input.hash).some(byte => byte !== 0) || Buffer.from(input.script).toString('hex') !== declared.coinbase
            : Buffer.from(input.hash).reverse().toString('hex') !== declared.txid || input.index !== declared.vout ||
              input.sequence !== declared.sequence || Buffer.from(input.script).toString('hex') !== (declared.scriptSig?.hex ?? declared.scriptsig ?? '');
        }) ||
        serialized.outs.length !== normalized.length ||
        serialized.outs.some((output, index) => Buffer.from(output.script).toString('hex') !== normalized[index].scriptpubkey || output.value.toString() !== String(normalized[index].value))) throw new Error('body');
  } catch { throw codeReadError('Code transaction ID does not commit to its exact raw source outputs.'); }
  if (row.status === 'confirmed' && (!raw.canonicalBlockScan ||
      raw.canonicalBlockScan.height !== Number(row.block_height) || raw.canonicalBlockScan.blockHash !== row.block_hash ||
      raw.canonicalBlockScan.blockIndex !== Number(row.block_index))) throw codeReadError('Code transaction has no exact canonical block witness.');
  return { txid: row.txid, vin, vout: normalized, blockTransactionIndex: Number(row.block_index),
    status: row.status === 'confirmed' ? { confirmed: true, block_height: Number(row.block_height), block_hash: row.block_hash } : { confirmed: false },
    timestamp: row.block_time };
}

/** Complete cold discovery is separate from this indexed public read. */
export async function readCodeSnapshot(client, network, params, { verifyCheckpoint } = {}) {
  const { snapshot: requested } = codeSnapshotRequest(params, network);
  const markerResult = await client.query('SELECT value FROM proof_indexer.meta WHERE key=$1', [CODE_DISCOVERY_META_KEY]);
  const observedMarker = markerResult.rows[0]?.value;
  const marker = observedMarker?.complete === true ? observedMarker : observedMarker?.lastGood;
  if (marker?.model !== CODE_DISCOVERY_MODEL || marker?.network !== network || marker?.complete !== true ||
      marker?.fromHeight !== 1 || !Number.isSafeInteger(marker.indexedThroughBlock) || marker.indexedThroughBlock < 1 ||
      !/^[0-9a-f]{64}$/u.test(marker.indexedThroughBlockHash) || !Number.isSafeInteger(marker.candidateCount) || marker.candidateCount < 0) {
    throw codeReadError('Historical Code candidate discovery is incomplete; run the supervised Code bootstrap before opening reads.', 503, 'CODE_DISCOVERY_INCOMPLETE');
  }
  const checkpointHeight = requested?.checkpointHeight ?? marker.indexedThroughBlock;
  const checkpointHash = requested?.checkpointHash ?? marker.indexedThroughBlockHash;
  if (checkpointHeight > marker.indexedThroughBlock) throw codeReadError('Code snapshot exceeds verified discovery coverage.');
  const blocks = await client.query(`SELECT height,block_hash FROM proof_indexer.blocks
    WHERE network=$1 AND canonical=true AND height=ANY($2::integer[])`, [network, [checkpointHeight, marker.indexedThroughBlock]]);
  if (!blocks.rows.some(row => Number(row.height) === checkpointHeight && row.block_hash === checkpointHash) ||
      !blocks.rows.some(row => Number(row.height) === marker.indexedThroughBlock && row.block_hash === marker.indexedThroughBlockHash)) {
    throw codeReadError('Code checkpoint was reorganized; restart the repository read.', 409, 'CODE_CHECKPOINT_REORG');
  }
  if (typeof verifyCheckpoint !== 'function' || await verifyCheckpoint(checkpointHeight) !== checkpointHash ||
      (checkpointHeight !== marker.indexedThroughBlock && await verifyCheckpoint(marker.indexedThroughBlock) !== marker.indexedThroughBlockHash)) {
    throw codeReadError('Code checkpoint cannot be verified against the canonical node.');
  }
  const closure = await client.query(`SELECT count(*)::text AS count FROM proof_indexer.transactions t
    JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash AND b.height=t.block_height AND b.canonical=true
    WHERE t.network=$1 AND t.status='confirmed' AND t.block_height<=$2 AND EXISTS
      (SELECT 1 FROM proof_indexer.op_returns o WHERE o.network=t.network AND o.txid=t.txid AND o.protocol='pwc1')`, [network, marker.indexedThroughBlock]);
  if (String(marker.candidateCount) !== closure.rows[0]?.count) throw codeReadError('Code candidate corpus differs from its complete discovery witness.');
  const result = await client.query(`SELECT t.*,
    (SELECT jsonb_agg(jsonb_build_object('vout',o.vout,'value_sats',o.value_sats::text,'scriptpubkey',o.scriptpubkey) ORDER BY o.vout)
      FROM proof_indexer.tx_outputs o WHERE o.network=t.network AND o.txid=t.txid) AS outputs
    FROM proof_indexer.transactions t LEFT JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash
    WHERE t.network=$1 AND ((t.status='confirmed' AND t.block_height<=$2 AND b.canonical=true AND b.height=t.block_height AND t.block_index>=0)
      OR t.status='pending') AND EXISTS
      (SELECT 1 FROM proof_indexer.op_returns o WHERE o.network=t.network AND o.txid=t.txid AND o.protocol='pwc1')
    ORDER BY CASE WHEN t.status='confirmed' THEN 0 ELSE 1 END,t.block_height,t.block_index,t.txid`, [network, marker.indexedThroughBlock]);
  const transactions = [], pendingWarnings = [];
  for (const row of result.rows) {
    try { transactions.push(codeTransactionFromRow(row, network)); }
    catch (error) {
      if (row.status === 'confirmed') throw error;
      pendingWarnings.push({ txid: row.txid, reason: 'pending-raw-evidence-unavailable' });
    }
  }
  const digest = transactions.filter(tx => tx.status.confirmed).reduce(advanceCodeCandidateDigest, CODE_DISCOVERY_EMPTY_SHA256);
  if (digest !== marker.candidateSha256) throw codeReadError('Code raw candidate corpus differs from its complete discovery commitment.');
  return { ...createCodeSnapshot({ network, checkpointHeight, checkpointHash,
    transactions: transactions.filter(tx => !tx.status.confirmed || tx.status.block_height <= checkpointHeight), generatedAt: marker.generatedAt
    }), pendingWarnings };
}
