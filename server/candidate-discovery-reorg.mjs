import { createHash } from 'node:crypto';
import { codeTransactionFromRow } from './db/code-reader.mjs';
import { CODE_DISCOVERY_META_KEY, CODE_DISCOVERY_MODEL, CODE_DISCOVERY_EMPTY_SHA256,
  advanceCodeCandidateDigest, prefilterCodeRawBlock, assertCodeRawBlockCandidatesMatch } from './code-repositories.mjs';
import { JOBS_DISCOVERY_META_KEY, JOBS_DISCOVERY_MODEL, JOBS_DISCOVERY_EMPTY_SHA256,
  advanceJobsCandidateDigest, isJobsCandidatePart } from './jobs.mjs';
import { JOBS_ACTIVATION_HEIGHT } from '../src/shared/protocol/jobs.mjs';

const HASH = /^[0-9a-f]{64}$/u;
const MAX_ORPHAN_BLOCKS = 12;
const MAX_PREFIX_CANDIDATES = 4096;
const PRODUCTS = {
  [CODE_DISCOVERY_META_KEY]: { model: CODE_DISCOVERY_MODEL, from: 1, empty: CODE_DISCOVERY_EMPTY_SHA256,
    digest: advanceCodeCandidateDigest, predicate: decoded => decoded.prefix === 'pwc1:' },
  [JOBS_DISCOVERY_META_KEY]: { model: JOBS_DISCOVERY_MODEL, from: JOBS_ACTIVATION_HEIGHT, empty: JOBS_DISCOVERY_EMPTY_SHA256,
    digest: advanceJobsCandidateDigest, predicate: isJobsCandidatePart },
};
function need(value, reason) { if (!value) throw new Error('Candidate discovery recovery: ' + reason); }

async function blockRows(client, network, height, lock) {
  return (await client.query('SELECT block_hash, previous_block_hash, canonical FROM proof_indexer.blocks WHERE network=$1 AND height=$2 ORDER BY block_hash' + (lock ? ' FOR SHARE' : ''), [network, height])).rows;
}
async function walkOrphan(client, rpc, network, marker, minimum, lock) {
  const detached = [];
  let height = marker.indexedThroughBlock, hash = marker.indexedThroughBlockHash;
  while (height >= minimum) {
    const active = await rpc('getblockhash', [height]);
    need(HASH.test(active), 'Core hash unavailable');
    const rows = await blockRows(client, network, height, lock);
    const row = rows.find(row => row.block_hash === hash);
    if (active === hash) {
      need(row?.canonical === true && rows.filter(row => row.canonical).length === 1 && detached.length, 'common ancestor is not uniquely canonical');
      return { ancestor: { height, hash }, detached: detached.reverse() };
    }
    need(row?.canonical === false && HASH.test(row.previous_block_hash) && detached.length < MAX_ORPHAN_BLOCKS, 'orphan row, parent or depth unavailable');
    // Core already knows the sibling even when the canonical worker has only
    // committed the ancestor. Any canonical DB row at this height must agree.
    need(rows.filter(row => row.canonical).every(row => row.block_hash === active), 'canonical database branch disagrees with Core');
    detached.push({ height, hash, parent: row.previous_block_hash, canonicalHash: active });
    height--; hash = row.previous_block_hash;
  }
  throw new Error('Candidate discovery recovery: fork crosses the discovery start');
}

async function prefixRows(client, network, key, product, ancestor) {
  const rows = await client.query(`SELECT t.*,
    (SELECT jsonb_agg(jsonb_build_object('vout',o.vout,'value_sats',o.value_sats::text,'scriptpubkey',o.scriptpubkey) ORDER BY o.vout)
     FROM proof_indexer.tx_outputs o WHERE o.network=t.network AND o.txid=t.txid) AS outputs
    FROM proof_indexer.transactions t JOIN proof_indexer.blocks b ON b.network=t.network
      AND b.block_hash=t.block_hash AND b.height=t.block_height AND b.canonical=true
    WHERE t.network=$1 AND t.status='confirmed' AND t.block_height BETWEEN $2 AND $3 AND EXISTS (
      SELECT 1 FROM proof_indexer.op_returns o WHERE o.network=t.network AND o.txid=t.txid
      AND (CASE WHEN $4::boolean THEN o.protocol='pwc1' ELSE o.protocol='pwm1' AND o.payload_hex LIKE '70776d313a6d3a70776a313a%' END))
    ORDER BY t.block_height,t.block_index,t.txid LIMIT $5`, [network, product.from, ancestor.height, key === CODE_DISCOVERY_META_KEY, MAX_PREFIX_CANDIDATES + 1]);
  need(rows.rows.length <= MAX_PREFIX_CANDIDATES, 'prefix candidate budget exceeded');
  return rows.rows.map(row => codeTransactionFromRow(row, network));
}

async function qualifyCandidateDiscoveryReorg({ client, rpc, network, key, marker, lock }) {
  const product = PRODUCTS[key];
  need(product && network === 'livenet' && marker?.network === network && marker.model === product.model &&
    marker.fromHeight === product.from && Number.isSafeInteger(marker.indexedThroughBlock) &&
    HASH.test(marker.indexedThroughBlockHash) && Number.isSafeInteger(marker.candidateCount) &&
    marker.candidateCount >= 0 && HASH.test(marker.candidateSha256) && Array.isArray(marker.blockedCandidates),
    'discovery marker has an unsupported identity or incomplete evidence');
  const { ancestor, detached } = await walkOrphan(client, rpc, network, marker, product.from - 1, lock);
  const prefix = await prefixRows(client, network, key, product, ancestor);
  const prefixDigest = prefix.reduce(product.digest, product.empty);
  const detachedIds = new Set();
  const checkpoints = new Map([[ancestor.height, { hash: ancestor.hash, count: prefix.length, digest: prefixDigest }]]);
  let count = prefix.length, digest = prefixDigest;
  for (const block of detached) {
    const raw = prefilterCodeRawBlock(await rpc('getblock', [block.hash, 0]), {
      blockHash: block.hash, previousBlockHash: block.parent, candidatePredicate: product.predicate });
    if (raw.noCodeCandidates) {
      checkpoints.set(block.height, { hash: block.hash, count, digest });
      continue;
    }
    const decoded = await rpc('getblock', [block.hash, 2]);
    need(decoded?.height === block.height && decoded.hash === block.hash && decoded.previousblockhash === block.parent,
      'orphan Core body at wrong position');
    assertCodeRawBlockCandidatesMatch(raw, decoded, product.predicate);
    for (const index of new Set(raw.candidates.map(candidate => candidate.transactionIndex))) {
      detachedIds.add(decoded.tx[index].txid);
      digest = product.digest(digest, { ...decoded.tx[index], height: block.height, _powBlockHash: block.hash, _powBlockIndex: index });
      count++;
    }
    checkpoints.set(block.height, { hash: block.hash, count, digest });
  }
  need(count === marker.candidateCount && digest === marker.candidateSha256, 'orphan candidate corpus differs from the recorded count or commitment');
  need(marker.blockedCandidates.every(txid => HASH.test(txid) && detachedIds.has(txid)),
    'unresolved candidates were not proved on the detached branch');
  // A partial bootstrap may have advanced beyond its last complete admission.
  // Validate that admission against the reconstructed corpus before promoting
  // the ancestor; an unclosed candidate can only disappear with its old branch.
  const base = marker.complete === true ? marker : marker.lastGood;
  need(base?.complete === true && base.network === network && base.model === product.model && base.fromHeight === product.from &&
    Number.isSafeInteger(base.indexedThroughBlock) && base.indexedThroughBlock >= product.from - 1 &&
    base.indexedThroughBlock <= marker.indexedThroughBlock && Array.isArray(base.blockedCandidates) && !base.blockedCandidates.length,
    'common prefix has no complete admission');
  let admitted = checkpoints.get(base.indexedThroughBlock);
  if (!admitted) {
    const hash = await rpc('getblockhash', [base.indexedThroughBlock]);
    const rows = await blockRows(client, network, base.indexedThroughBlock, lock);
    need(HASH.test(hash) && rows.filter(row => row.canonical).length === 1 && rows.some(row => row.canonical && row.block_hash === hash),
      'prior complete admission is not canonical');
    const before = prefix.filter(tx => tx.status.block_height <= base.indexedThroughBlock);
    admitted = { hash, count: before.length, digest: before.reduce(product.digest, product.empty) };
  }
  need(admitted.hash === base.indexedThroughBlockHash && admitted.count === base.candidateCount && admitted.digest === base.candidateSha256,
    'prior complete admission differs from the reconstructed corpus');
  return { model: 'candidate-discovery-canonical-reorg-v1', key, network, marker, ancestor, detached,
    prefixCount: prefix.length, prefixSha256: prefixDigest };
}

export async function recoverCandidateDiscoveryReorg({ client, rpc, network, key, marker, dryRun = false }) {
  await client.query(dryRun ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    const currentMarker = await client.query('SELECT 1 FROM proof_indexer.meta WHERE key=$1 AND value=$2::jsonb',
      [key, JSON.stringify(marker)]);
    need(currentMarker.rowCount === 1, 'discovery marker differs from the proposed input');
    const proof = await qualifyCandidateDiscoveryReorg({ client, rpc, network, key, marker, lock: !dryRun });
    // A changing sibling at any detached height or a changed network tip ancestry
    // invalidates this plan. Preserve the old marker and retry from a fresh cut.
    for (const block of [proof.ancestor, ...proof.detached]) {
      const current = await rpc('getblockhash', [block.height]);
      need(current === (block.canonicalHash ?? block.hash), 'canonical branch changed before commit');
    }
    const identity = createHash('sha256').update(JSON.stringify(proof)).digest('hex');
    const evidenceKey = key + ':reorg:' + identity;
    const next = { model: marker.model, network, fromHeight: marker.fromHeight,
      indexedThroughBlock: proof.ancestor.height, indexedThroughBlockHash: proof.ancestor.hash,
      candidateCount: proof.prefixCount, candidateSha256: proof.prefixSha256, complete: true, blockedCandidates: [],
      reason: '', generatedAt: new Date().toISOString(), recoveryEvidenceKey: evidenceKey };
    if (!dryRun) {
      await client.query('INSERT INTO proof_indexer.meta(key,value,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(key) DO NOTHING', [evidenceKey, JSON.stringify(proof)]);
      const saved = await client.query('SELECT 1 FROM proof_indexer.meta WHERE key=$1 AND value=$2::jsonb', [evidenceKey, JSON.stringify(proof)]);
      need(saved.rowCount === 1, 'immutable recovery evidence differs');
      const changed = await client.query('UPDATE proof_indexer.meta SET value=$1::jsonb,updated_at=now() WHERE key=$2 AND value=$3::jsonb',
        [JSON.stringify(next), key, JSON.stringify(marker)]);
      need(changed.rowCount === 1, 'discovery marker changed before commit');
    }
    await client.query('COMMIT');
    return { proof, next };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
