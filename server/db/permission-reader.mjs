import { createHash } from 'node:crypto';
import { WORK_AMO_V5_ACTIVATION_HEIGHT, WORK_AMO_V5_BLOCK_SEQUENCER_MODEL } from '../work-amo-v5.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL } from '../work-amo-v8.mjs';
import { permissionReadError } from '../permissions.mjs';

/** Complete canonical block rows for the independent raw-Core permission reader.
 * readScan is the existing latestProofIndexScanMetadata callback. No marker or
 * migration is written. The caller independently verifies every block body. */
export function createPermissionIndexDiscovery({ pool: getPool, readScan }) {
  return async function readIndex(network, options = {}) {
    const pool = typeof getPool === 'function' ? getPool() : getPool;
    const { activationHeight, activationPreviousBlockHash, expectedHeight, expectedHash, onBlock, verifiedPrefix } = options;
    const fromHeight = options.fromHeight ?? activationHeight;
    const hashPattern = /^[0-9a-f]{64}$/u;
    if (!pool || network !== 'livenet' || typeof readScan !== 'function' || !Number.isSafeInteger(activationHeight) || activationHeight < WORK_AMO_V5_ACTIVATION_HEIGHT ||
        !hashPattern.test(activationPreviousBlockHash ?? '') || !Number.isSafeInteger(expectedHeight) || expectedHeight < activationHeight - 1 ||
        !hashPattern.test(expectedHash ?? '') || typeof onBlock !== 'function' || !Number.isSafeInteger(fromHeight) || fromHeight < activationHeight || fromHeight > expectedHeight + 1 ||
        (fromHeight > activationHeight && (!verifiedPrefix || verifiedPrefix.height !== fromHeight - 1 || !hashPattern.test(verifiedPrefix.blockHash ?? '') || !hashPattern.test(verifiedPrefix.witnessSha256 ?? ''))) ||
        (verifiedPrefix && verifiedPrefix.height !== fromHeight - 1) || (expectedHeight === activationHeight - 1 && expectedHash !== activationPreviousBlockHash)) throw permissionReadError('Permission discovery requires configured exact canonical coverage.');
    const client = await pool.connect();
    const scanReady = scan => scan?.payload?.complete === true && scan?.consistency?.ok === true && scan?.consistency?.status === 'block-scan-current' &&
      Number(scan?.indexed_through_block) === expectedHeight && Number(scan?.payload?.tipHeight) === expectedHeight &&
      String(scan?.payload?.indexedThroughBlockHash ?? scan?.payload?.blockHash ?? scan?.source_hashes?.blockScan ?? '').toLowerCase() === expectedHash;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '30s'");
      if (!scanReady(await readScan(client, network))) throw permissionReadError('Permission index is not complete at the exact Core checkpoint.');
      // Accepted node overlays may externalize immutable transition witnesses.
      // Discover the fixed audited accessor; never assume inline JSON is complete.
      const native = await client.query(`/* permission_transition_storage_accessor */ SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='proof_indexer' AND p.proname='read_work_transition_payload_v1' AND p.pronargs=4
      ) AS present`);
      const usesNativeWitness = native.rows[0]?.present === true;
      const transitionPayload = usesNativeWitness ? 'witness.payload' : 'transition.payload';
      const nativeWitnessJoin = usesNativeWitness ? `LEFT JOIN LATERAL (
        SELECT proof_indexer.read_work_transition_payload_v1(transition.network,transition.block_height,transition.block_hash,transition.payload) AS payload
        WHERE transition.block_height IS NOT NULL OFFSET 0
      ) witness ON true` : '';
      const anchorHeight = verifiedPrefix?.height ?? activationHeight - 1;
      const anchorHash = verifiedPrefix?.blockHash ?? activationPreviousBlockHash;
      const anchor = await client.query(`/* permission_verified_prefix_anchor */ SELECT block_hash FROM proof_indexer.blocks
        WHERE network=$1 AND canonical=true AND height=$2 ORDER BY block_hash LIMIT 2`, [network, anchorHeight]);
      if (anchor.rows.length !== 1 || anchor.rows[0].block_hash !== anchorHash) throw permissionReadError('Permission verified parent/prefix is no longer canonical in the index.');
      let height = fromHeight, previousHash = anchorHash;
      let witnessSha256 = verifiedPrefix?.witnessSha256 ?? createHash('sha256').update(JSON.stringify(['permission-block-witness-chain-v1', network, activationHeight, activationPreviousBlockHash])).digest('hex');
      while (height <= expectedHeight) {
        const result = await client.query(`/* permission_raw_block_coverage */
          SELECT block.height,block.block_hash,block.previous_block_hash,
            count(*) OVER (PARTITION BY block.height) AS canonical_height_count,
            transition.complete,transition.block_atomic,transition.fee_once,transition.invalid_zero,
            transition.model,transition.protocol_record_count,transition.raw_protocol_candidate_count,
            jsonb_build_object('replayRecords',${transitionPayload}->'replayRecords',
              'replayDescriptorCommitment',${transitionPayload}->'replayDescriptorCommitment',
              'blockDescriptorCommitment',${transitionPayload}->'blockDescriptorCommitment',
              'rawProtocolCandidateCount',${transitionPayload}->'rawProtocolCandidateCount') AS payload
          FROM proof_indexer.blocks block LEFT JOIN proof_indexer.work_amo_block_transitions transition
            ON transition.network=block.network AND transition.block_height=block.height AND transition.block_hash=block.block_hash
            AND transition.previous_block_hash=block.previous_block_hash
          ${nativeWitnessJoin}
          WHERE block.network=$1 AND block.canonical=true AND block.height >= $2 AND block.height <= $3
          ORDER BY block.height,block.block_hash LIMIT 8`, [network, height, expectedHeight]);
        if (!result.rows.length) throw permissionReadError('Permission raw block coverage has a gap.');
        for (const row of result.rows) {
          if (Number(row.height) !== height || Number(row.canonical_height_count) !== 1 || !hashPattern.test(row.block_hash ?? '') ||
              row.previous_block_hash !== previousHash || row.complete !== true || row.block_atomic !== true || row.fee_once !== true || row.invalid_zero !== true ||
              ![WORK_AMO_V5_BLOCK_SEQUENCER_MODEL, WORK_AMO_V8_BLOCK_SEQUENCER_MODEL].includes(row.model)) throw permissionReadError('Permission block witnesses are incomplete or noncontiguous.');
          await onBlock(row);
          witnessSha256 = createHash('sha256').update(JSON.stringify([witnessSha256, height, row.block_hash,
            row.payload?.blockDescriptorCommitment, row.payload?.replayDescriptorCommitment])).digest('hex');
          previousHash = row.block_hash; height += 1;
        }
      }
      if (height !== expectedHeight + 1 || previousHash !== expectedHash) throw permissionReadError('Permission coverage does not reach the exact checkpoint.');
      const pending = await client.query(`/* permission_pending_candidates */ SELECT DISTINCT carrier.txid
        FROM proof_indexer.op_returns carrier JOIN proof_indexer.transactions tx ON tx.network=carrier.network AND tx.txid=carrier.txid
        WHERE carrier.network=$1 AND carrier.protocol='pwm1' AND tx.status='pending'
          AND carrier.payload_hex LIKE '70776d313a6d3a70777065726d313a%' ORDER BY carrier.txid LIMIT 256`, [network]);
      await client.query('COMMIT');
      if (!scanReady(await readScan(pool, network))) throw permissionReadError('Permission index checkpoint changed during discovery.');
      return { complete: true, activationHeight, activationPreviousBlockHash, indexedThroughBlock: expectedHeight,
        checkpointHash: expectedHash, blockCount: expectedHeight - activationHeight + 1, witnessSha256, pendingTxids: pending.rows.map(row => row.txid) };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  };
}
