import * as bitcoin from 'bitcoinjs-lib';
import { createHash } from 'node:crypto';
import { enumerateCodePageSources, CODE_REFERENCE_ACTIVATION_HEIGHT,
  CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT, CODE_REFERENCE_ACTIVATION_PARENT_HASH, CODE_REFERENCE_NETWORK } from '../../src/shared/protocol/codeRepository.mjs';
import { createCodeSnapshot, codeSnapshotRequest, codeReadError, CODE_DISCOVERY_MODEL, CODE_DISCOVERY_META_KEY, CODE_DISCOVERY_EMPTY_SHA256, CODE_SNAPSHOT_MODEL, advanceCodeCandidateDigest, exactCodeOutputProofs } from '../code-repositories.mjs';

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
  return { txid: row.txid, network, vin, vout: normalized, blockTransactionIndex: Number(row.block_index),
    status: row.status === 'confirmed' ? { confirmed: true, block_height: Number(row.block_height), block_hash: row.block_hash } : { confirmed: false },
    timestamp: row.block_time };
}

/** Complete cold discovery is separate from this indexed public read. */
async function readCodeCheckpoint(client, network, params, { verifyCheckpoint } = {}) {
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
  return { marker, checkpointHeight, checkpointHash };
}

async function verifyReferenceActivation(client, network, checkpointHeight, verifyCheckpoint, required = false) {
  if (network !== CODE_REFERENCE_NETWORK || checkpointHeight < CODE_REFERENCE_ACTIVATION_HEIGHT) {
    if (required) throw codeReadError('Page references are not active at this network checkpoint.', 409, 'CODE_REFERENCE_NOT_ACTIVE');
    return false;
  }
  const blocks = await client.query('SELECT height,block_hash FROM proof_indexer.blocks WHERE network=$1 AND canonical=true AND height=$2',
    [network, CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT]);
  if (!blocks.rows.some(row => Number(row.height) === CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT && row.block_hash === CODE_REFERENCE_ACTIVATION_PARENT_HASH) ||
      typeof verifyCheckpoint !== 'function' || await verifyCheckpoint(CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT) !== CODE_REFERENCE_ACTIVATION_PARENT_HASH) {
    throw codeReadError('Page reference activation does not match the canonical pinned parent.', 503, 'CODE_REFERENCE_ACTIVATION_UNAVAILABLE');
  }
  return true;
}

/** Authenticated first-party Core proves positive membership or complete absence.
 * A database miss alone never rejects a reference. These reads never persist or
 * add a source transaction to the Code discovery corpus. */
export async function codeReferenceSourceFromCore({ txid, network, checkpointHeight, checkpointHash }, rpc) {
  const unavailable = () => codeReadError('Referenced Page Core evidence is unavailable.', 503, 'CODE_REFERENCE_SOURCE_UNAVAILABLE');
  if (network !== CODE_REFERENCE_NETWORK || !/^[a-f0-9]{64}$/u.test(txid ?? '') || typeof rpc !== 'function') throw unavailable();
  const call = async (method, args) => { try { return await rpc(method, args); } catch { throw unavailable(); } };
  const fence = async () => {
    const result = await call('getblockhash', [checkpointHeight]);
    if (!result?.ok || result.result !== checkpointHash) throw codeReadError('Code checkpoint changed while verifying Page evidence.', 409, 'CODE_CHECKPOINT_REORG');
  };
  await fence();
  let response = await call('getrawtransaction', [txid, true]);
  if (!response?.ok) {
    if (Number(response?.error?.code) !== -5) throw unavailable();
    const [chainResponse, indexResponse] = await Promise.all([call('getblockchaininfo', []), call('getindexinfo', ['txindex'])]);
    const chain = chainResponse?.ok ? chainResponse.result : null;
    const index = indexResponse?.ok ? indexResponse.result?.txindex : null;
    if (chain?.chain !== 'main' || chain.pruned !== false || chain.initialblockdownload !== false ||
        !Number.isSafeInteger(chain.blocks) || chain.blocks < checkpointHeight || !/^[a-f0-9]{64}$/u.test(chain.bestblockhash ?? '') ||
        index?.synced !== true || index.best_block_height !== chain.blocks) throw unavailable();
    // Repeat after establishing complete txindex authority; a lookup performed
    // while txindex was catching up cannot establish historical absence.
    response = await call('getrawtransaction', [txid, true]);
    if (!response?.ok) {
      const [mempool, after] = await Promise.all([call('getmempoolentry', [txid]), call('getblockchaininfo', [])]);
      if (Number(response?.error?.code) !== -5 || mempool?.ok || Number(mempool?.error?.code) !== -5 ||
          !after?.ok || after.result?.blocks !== chain.blocks || after.result?.bestblockhash !== chain.bestblockhash) throw unavailable();
      await fence();
      return { txid, network, status: 'unavailable-at-checkpoint', referenceAbsent: true, checkpointHeight, checkpointHash };
    }
  }
  const raw = response.result;
  if (raw?.txid !== txid || typeof raw.hex !== 'string' || !Array.isArray(raw.vin) || !Array.isArray(raw.vout)) throw unavailable();
  let height = null, blockHash = null, blockIndex = null, confirmed = false;
  if (raw.blockhash) {
    if (!/^[a-f0-9]{64}$/u.test(raw.blockhash)) throw unavailable();
    const blockResponse = await call('getblock', [raw.blockhash, 1]);
    const block = blockResponse?.ok ? blockResponse.result : null;
    if (block?.hash !== raw.blockhash || !Number.isSafeInteger(block.height) || block.height < 1 ||
        !Array.isArray(block.tx) || block.tx.filter(id => id === txid).length !== 1) throw unavailable();
    height = block.height; blockHash = block.hash; blockIndex = block.tx.indexOf(txid);
    const canonical = await call('getblockhash', [height]);
    if (!canonical?.ok) throw unavailable();
    confirmed = canonical.result === blockHash;
    if ((confirmed && !(Number(block.confirmations) > 0)) || (!confirmed && Number(block.confirmations) !== -1)) throw unavailable();
  }
  const normalized = codeTransactionFromRow({ txid, status: confirmed ? 'confirmed' : 'pending', block_height: height,
    block_hash: blockHash, block_index: blockIndex,
    raw_tx: { ...raw, ...(confirmed ? { canonicalBlockScan: { height, blockHash, blockIndex } } : {}) },
    outputs: raw.vout.map((output, vout) => ({ vout, value_sats: exactCodeOutputProofs(output),
      scriptpubkey: output.scriptpubkey ?? output.scriptPubKey?.hex ?? output.scriptPubKeyHex ?? '' })) }, network);
  await fence();
  return normalized;
}

async function readReferenceSources(network, txids, checkpointHeight, checkpointHash, resolveReferenceSource) {
  if (typeof resolveReferenceSource !== 'function') throw codeReadError('Authenticated Page source lookup is unavailable.', 503, 'CODE_REFERENCE_SOURCE_UNAVAILABLE');
  const sources = new Map();
  for (const txid of txids) {
    const source = await resolveReferenceSource({ txid, network, checkpointHeight, checkpointHash });
    if (!source || source.txid !== txid || source.network !== network) throw codeReadError('Page source lookup returned different evidence.');
    sources.set(txid, source);
  }
  return sources;
}

export async function readCodePageSource(client, network, params, { verifyCheckpoint, resolveReferenceSource } = {}) {
  const txid = params.get('txid') ?? '';
  if (!/^[a-f0-9]{64}$/u.test(txid)) throw codeReadError('Page source must be its exact transaction ID.', 400, 'CODE_PAGE_TXID_INVALID');
  const { checkpointHeight, checkpointHash } = await readCodeCheckpoint(client, network, params, { verifyCheckpoint });
  await verifyReferenceActivation(client, network, checkpointHeight, verifyCheckpoint, true);
  const tx = (await readReferenceSources(network, [txid], checkpointHeight, checkpointHash, resolveReferenceSource)).get(txid);
  if (tx.status?.confirmed !== true || tx.status.block_height > checkpointHeight) throw codeReadError('Only a confirmed Page can be referenced.', 409, 'CODE_PAGE_SOURCE_UNCONFIRMED');
  let sources;
  try { sources = enumerateCodePageSources(tx, { sha256: bytes => createHash('sha256').update(bytes).digest('hex') }); }
  catch (error) { throw codeReadError(error.message || 'Page raw source is invalid.', 400, 'CODE_PAGE_SOURCE_INVALID'); }
  if (!sources.length) throw codeReadError('This transaction has no eligible HTML Page source.', 400, 'CODE_PAGE_SOURCE_INVALID');
  if (await verifyCheckpoint(checkpointHeight) !== checkpointHash) throw codeReadError('Code checkpoint changed while verifying Page source.', 409, 'CODE_CHECKPOINT_REORG');
  const snapshot = { model: CODE_SNAPSHOT_MODEL, network, checkpointHeight, checkpointHash };
  return { network, complete: true, referenceEnabled: true, snapshot: { ...snapshot, id: Buffer.from(JSON.stringify(snapshot)).toString('base64url') },
    sourceTxid: txid, blockHeight: tx.status.block_height, blockHash: tx.status.block_hash,
    blockTransactionIndex: tx.blockTransactionIndex, sources: sources.map(({ kind, vout, name, sha256, size, content, data }) =>
      ({ kind, vout, name, sha256, size, content, contentBase64: Buffer.from(data, 'base64url').toString('base64') })) };
}

/** Complete Code discovery and separate immutable Page dependencies. */
export async function readCodeSnapshot(client, network, params, { verifyCheckpoint, resolveReferenceSource } = {}) {
  const { marker, checkpointHeight, checkpointHash } = await readCodeCheckpoint(client, network, params, { verifyCheckpoint });
  const referenceEnabled = await verifyReferenceActivation(client, network, checkpointHeight, verifyCheckpoint);
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
  const checkpointTransactions = transactions.filter(tx => !tx.status.confirmed || tx.status.block_height <= checkpointHeight);
  const referenceSources = new Map();
  // Hydrate only dependencies demanded by an otherwise applicable confirmed
  // commit. Stale/foreign/malformed records cannot make arbitrary lookups block
  // an unrelated canonical repository. Replay itself determines that boundary.
  for (;;) {
    try {
      const state = createCodeSnapshot({ network, checkpointHeight, checkpointHash, referenceSources,
        transactions: checkpointTransactions, generatedAt: marker.generatedAt });
      if (referenceSources.size && await verifyCheckpoint(checkpointHeight) !== checkpointHash) {
        throw codeReadError('Code checkpoint changed while verifying referenced Pages.', 409, 'CODE_CHECKPOINT_REORG');
      }
      return { ...state, pendingWarnings, referenceEnabled };
    } catch (error) {
      if (error?.code !== 'CODE_REFERENCE_SOURCE_UNAVAILABLE' || !/^[a-f0-9]{64}$/u.test(error.sourceTxid ?? '') ||
          referenceSources.has(error.sourceTxid)) throw error;
      const loaded = await readReferenceSources(network, [error.sourceTxid], checkpointHeight, checkpointHash, resolveReferenceSource);
      for (const [txid, source] of loaded) referenceSources.set(txid, source);
    }
  }
}
