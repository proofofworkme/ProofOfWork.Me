import { createHash } from "node:crypto";
import { workMailBatchDeclarationCommitment, WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT, WORK_MAIL_BATCH_ACTIVATION_META_KEY, validateWorkMailBatchActivationMarker, normalizeWorkMailBatchDeclarationPins } from "../work-mail-batch-declaration.mjs";
import { isDeepStrictEqual } from "node:util";


const HASH = /^[0-9a-f]{64}$/u;
const prefixUnavailable = () => new Error("WORK Mail batch canonical discovery prefix is unavailable or inconsistent.");

function blockScanSnapshotId(network, blockHeight, blockHash) {
  // Same identity as storeBlockScanSnapshot: a primary-key lookup, never a
  // historical snapshot search or a scan of transition JSON.
  return createHash("sha256").update(JSON.stringify({
    indexedThroughBlock: blockHeight, indexedThroughBlockHash: blockHash,
    network, source: "block-scan",
  })).digest("hex").slice(0, 24);
}

async function workMailBatchDiscoveryWitness(pool, network, maximumBlockHeight = null) {
  if (!pool || (maximumBlockHeight !== null &&
      (!Number.isSafeInteger(maximumBlockHeight) || maximumBlockHeight < WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT - 1))) {
    throw prefixUnavailable();
  }
  const result = await pool.query(`
    /* work_mail_batch_discovery_state */
    SELECT
      (SELECT value FROM proof_indexer.meta WHERE key = 'canonical:rebuild') AS rebuild,
      (SELECT value FROM proof_indexer.meta WHERE key = 'canonical:fault') AS fault,
      (SELECT block_hash FROM proof_indexer.blocks
        WHERE network = $1 AND height = $2 AND canonical = true) AS requested_hash
  `, [network, maximumBlockHeight]);
  if (result.rows.length !== 1) throw prefixUnavailable();
  const { rebuild, fault, requested_hash: requestedHash } = result.rows[0];
  const ordinary = value => value && typeof value === "object" && !Array.isArray(value);
  const active = rebuild?.status === "active" && rebuild.active === true && rebuild.complete === false;
  const complete = rebuild?.status === "complete" && rebuild.active === false && rebuild.complete === true;
  if (!ordinary(rebuild) || rebuild.network !== network || (!active && !complete) ||
      rebuild.transactionNormalization !== "canonical-raw-tx-only" || rebuild.fault != null ||
      !Number.isSafeInteger(rebuild.fromHeight) || rebuild.fromHeight < 1 ||
      rebuild.fromHeight > WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT ||
      rebuild.bootstrapHeight !== rebuild.fromHeight - 1 || !HASH.test(rebuild.bootstrapHash ?? "") ||
      !Number.isSafeInteger(rebuild.indexedThroughBlock) ||
      rebuild.indexedThroughBlock < WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT - 1 ||
      !HASH.test(rebuild.indexedThroughBlockHash ?? "") ||
      (rebuild.mode != null && rebuild.mode !== "pwt-range-replay") ||
      (rebuild.mode === "pwt-range-replay" && (
        !Number.isSafeInteger(rebuild.rangeReplayFromHeight) ||
        rebuild.rangeReplayFromHeight < rebuild.fromHeight ||
        rebuild.indexedThroughBlock < rebuild.rangeReplayFromHeight - 1
      )) ||
      (fault != null && (!ordinary(fault) || fault.network !== network || fault.active !== false))) {
    throw prefixUnavailable();
  }
  const blockHeight = maximumBlockHeight === null
    ? rebuild.indexedThroughBlock : Math.min(maximumBlockHeight, rebuild.indexedThroughBlock);
  const blockHash = blockHeight === rebuild.indexedThroughBlock
    ? rebuild.indexedThroughBlockHash : requestedHash;
  if (!HASH.test(blockHash ?? "")) throw prefixUnavailable();
  return {
    rebuild, blockHeight, blockHash, coverageHeight: rebuild.indexedThroughBlock,
    coverageHash: rebuild.indexedThroughBlockHash,
    snapshotId: blockScanSnapshotId(network, rebuild.indexedThroughBlock, rebuild.indexedThroughBlockHash),
    retainedBaseHeight: rebuild.mode === "pwt-range-replay" &&
      rebuild.rangeReplayFromHeight > WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT
      ? rebuild.rangeReplayFromHeight - 1 : null,
  };
}

// The canonical worker commits each block, its raw protocol carriers, seal,
// rebuild checkpoint and deterministic scan snapshot in one transaction. It
// advances only one height after checking Core's parent hash and the replay
// opening/closing state. The original fromHeight/bootstrap lineage survives
// PWT range replay. Requiring it to start no later than the declaration floor
// covers every eligible candidate; the bootstrap is not a claim about genesis.
// These exact anchors and immediate predecessor seals qualify the durable
// prefix without walking every historical block on each wallet read. A suffix
// replay beginning after the declaration floor additionally proves its retained
// R-1/R-2 base and the first rebuilt R seal, so completion may retain its original
// range start without forgetting earlier eligible declaration carriers.
function workMailBatchCoveredPrefixSql({ rebuild, snapshot, coverageHeight, coverageHash, height, blockHash, retainedBaseHeight }) {
  const sealProof = (seal, parent, canonical) => `
      ${seal}.block_hash = ${canonical}.block_hash
      AND ${seal}.previous_block_hash = ${canonical}.previous_block_hash
      AND ${seal}.complete = true AND ${seal}.block_atomic = true
      AND ${seal}.fee_once = true AND ${seal}.invalid_zero = true
      AND ${seal}.state_commitment_model = 'canonical-work-amo-sufficient-state-sha256-v1'
      AND ${seal}.opening_state_sha256 = ${parent}.closing_state_sha256
      AND ${seal}.previous_block_hash = ${parent}.block_hash
      AND ${seal}.opening_state_sha256 ~ '^[0-9a-f]{64}$'
      AND ${seal}.closing_state_sha256 ~ '^[0-9a-f]{64}$'
      AND ${seal}.payload->>'transitionChainModel' = 'canonical-work-amo-raw-transition-chain-sha256-v1'
      AND ${seal}.payload->'transitionChainCommitment'->>'model' = 'canonical-work-amo-raw-transition-chain-sha256-v1'
      AND ${seal}.payload->'transitionChainCommitment'->>'sha256' ~ '^[0-9a-f]{64}$'
      AND ${seal}.payload->'transitionChainCommitment'->>'payloadBytes' ~ '^[1-9][0-9]*$'
      AND ${parent}.complete = true AND ${parent}.block_atomic = true
      AND ${parent}.fee_once = true AND ${parent}.invalid_zero = true`;
  return `covered_scan AS MATERIALIZED (
    SELECT scan.snapshot_id, coverage.height AS coverage_height,
      coverage.block_hash AS coverage_hash, checkpoint.height AS checkpoint_height,
      checkpoint.block_hash AS checkpoint_hash
    FROM proof_indexer.meta state
    JOIN proof_indexer.ledger_snapshots scan
      ON scan.network = $1 AND scan.snapshot_id = ${snapshot}
     AND scan.indexed_through_block = ${coverageHeight}
    JOIN proof_indexer.blocks coverage
      ON coverage.network = $1 AND coverage.height = ${coverageHeight}
     AND coverage.block_hash = ${coverageHash} AND coverage.canonical = true
    JOIN proof_indexer.blocks checkpoint
      ON checkpoint.network = $1 AND checkpoint.height = ${height}
     AND checkpoint.block_hash = ${blockHash} AND checkpoint.canonical = true
    JOIN proof_indexer.work_amo_block_transitions coverage_seal
      ON coverage_seal.network = $1 AND coverage_seal.block_height = coverage.height
    JOIN proof_indexer.work_amo_block_transitions coverage_parent
      ON coverage_parent.network = $1 AND coverage_parent.block_height = coverage.height - 1
    JOIN proof_indexer.blocks coverage_parent_block
      ON coverage_parent_block.network = $1 AND coverage_parent_block.height = coverage.height - 1
     AND coverage_parent_block.block_hash = coverage_parent.block_hash AND coverage_parent_block.canonical = true
    JOIN proof_indexer.work_amo_block_transitions checkpoint_seal
      ON checkpoint_seal.network = $1 AND checkpoint_seal.block_height = checkpoint.height
    JOIN proof_indexer.work_amo_block_transitions checkpoint_parent
      ON checkpoint_parent.network = $1 AND checkpoint_parent.block_height = checkpoint.height - 1
    JOIN proof_indexer.blocks checkpoint_parent_block
      ON checkpoint_parent_block.network = $1 AND checkpoint_parent_block.height = checkpoint.height - 1
     AND checkpoint_parent_block.block_hash = checkpoint_parent.block_hash AND checkpoint_parent_block.canonical = true
    WHERE state.key = 'canonical:rebuild' AND state.value = ${rebuild}::jsonb
      AND NOT EXISTS (SELECT 1 FROM proof_indexer.meta fault
        WHERE fault.key = 'canonical:fault' AND (
          fault.value->>'network' = $1 AND fault.value->'active' = 'false'::jsonb) IS NOT TRUE)
      AND checkpoint.height <= coverage.height
      AND scan.source_hashes->>'blockScan' = coverage.block_hash
      AND NOT (scan.source_hashes ? 'canonicalSummary')
      AND scan.payload->>'source' = 'proof-indexer-block-scan'
      AND scan.payload->>'network' = $1 AND scan.payload->>'snapshotId' = scan.snapshot_id
      AND scan.payload->'rebuild' = state.value
      AND scan.payload->>'indexedThroughBlock' = coverage.height::text
      AND scan.metrics->>'indexedThroughBlock' = coverage.height::text
      AND scan.payload->>'indexedThroughBlockHash' = coverage.block_hash
      AND scan.metrics->>'indexedThroughBlockHash' = coverage.block_hash
      AND scan.payload->'complete' = scan.metrics->'complete'
      AND scan.payload->'tipHeight' = scan.metrics->'tipHeight'
      AND CASE WHEN scan.payload->>'tipHeight' ~ '^[0-9]{1,10}$'
        THEN (scan.payload->>'tipHeight')::bigint >= coverage.height ELSE false END
      AND (
        (scan.payload->'complete' = 'true'::jsonb
          AND scan.payload->>'tipHeight' = coverage.height::text
          AND scan.consistency->'ok' = 'true'::jsonb
          AND scan.consistency->>'status' = 'block-scan-current')
        OR (scan.payload->'complete' = 'false'::jsonb
          AND scan.consistency->'ok' = 'false'::jsonb
          AND scan.consistency->>'status' = 'block-scan-partial')
      )
      AND ${sealProof("coverage_seal", "coverage_parent", "coverage")}
      AND ${sealProof("checkpoint_seal", "checkpoint_parent", "checkpoint")}

      AND (${retainedBaseHeight}::integer IS NULL OR EXISTS (
        SELECT 1
        FROM proof_indexer.work_amo_block_transitions retained_base
        JOIN proof_indexer.blocks retained_block
          ON retained_block.network = $1 AND retained_block.height = ${retainedBaseHeight}
         AND retained_block.block_hash = retained_base.block_hash AND retained_block.canonical = true
        JOIN proof_indexer.work_amo_block_transitions retained_parent
          ON retained_parent.network = $1 AND retained_parent.block_height = ${retainedBaseHeight} - 1
        JOIN proof_indexer.blocks retained_parent_block
          ON retained_parent_block.network = $1 AND retained_parent_block.height = retained_parent.block_height
         AND retained_parent_block.block_hash = retained_parent.block_hash AND retained_parent_block.canonical = true
        LEFT JOIN proof_indexer.work_amo_block_transitions first_replayed
          ON first_replayed.network = $1 AND first_replayed.block_height = ${retainedBaseHeight} + 1
        LEFT JOIN proof_indexer.blocks first_replayed_block
          ON first_replayed_block.network = $1 AND first_replayed_block.height = ${retainedBaseHeight} + 1
         AND first_replayed_block.block_hash = first_replayed.block_hash AND first_replayed_block.canonical = true
        WHERE retained_base.network = $1 AND retained_base.block_height = ${retainedBaseHeight}
          AND ${sealProof("retained_base", "retained_parent", "retained_block")}
          AND (coverage.height = ${retainedBaseHeight} OR
            (first_replayed_block.canonical = true AND
              ${sealProof("first_replayed", "retained_base", "first_replayed_block")}))
      ))
  )`;
}

function exactWorkMailBatchPrefixRow(row, witness) {
  if (!row || row.checkpoint_height !== witness.blockHeight || row.checkpoint_hash !== witness.blockHash ||
      row.coverage_height !== witness.coverageHeight || row.coverage_hash !== witness.coverageHash ||
      row.snapshot_id !== witness.snapshotId) throw prefixUnavailable();
  return row;
}

export async function readWorkMailBatchDiscoveryCheckpoint(pool, network, { maximumBlockHeight = null } = {}) {
  if (network !== "livenet") return null;
  const witness = await workMailBatchDiscoveryWitness(pool, network, maximumBlockHeight);
  const prefix = workMailBatchCoveredPrefixSql({ rebuild: "$2", snapshot: "$3", coverageHeight: "$4",
    coverageHash: "$5", height: "$6", blockHash: "$7", retainedBaseHeight: "$8" });
  const result = await pool.query(`/* work_mail_batch_discovery_checkpoint */ WITH ${prefix} SELECT * FROM covered_scan`,
    [network, JSON.stringify(witness.rebuild), witness.snapshotId, witness.coverageHeight,
      witness.coverageHash, witness.blockHeight, witness.blockHash, witness.retainedBaseHeight]);
  if (result.rows.length !== 1) throw prefixUnavailable();
  exactWorkMailBatchPrefixRow(result.rows[0], witness);
  return { blockHeight: witness.blockHeight, blockHash: witness.blockHash, complete: true,
    source: "proof-indexer-work-mail-batch-discovery-checkpoint" };
}

/** Exact-carrier discovery through a requested historical boundary. Raw Core
 * hydration and declaration authority checks belong to the caller; filtering
 * on stored prevouts here could hide an earlier candidate with missing data. */
export async function readWorkMailBatchDeclarationCandidates(pool, network, options = {}) {
  const height = options.expectedTipHeight;
  const blockHash = options.expectedTipHash;
  const limit = options.limit ?? 32;
  const after = options.after ?? null;
  if (after !== null && (
      !after || typeof after !== "object" || Array.isArray(after) ||
      Object.keys(after).some(key => !["blockHeight", "blockTransactionIndex", "txid"].includes(key)) ||
      !Number.isSafeInteger(after.blockHeight) || after.blockHeight < 1 || after.blockHeight > height ||
      !Number.isSafeInteger(after.blockTransactionIndex) || after.blockTransactionIndex < 0 || after.blockTransactionIndex > 2147483647 ||
      typeof after.txid !== "string" || !/^[0-9a-f]{64}$/u.test(after.txid)
  )) return null;
  if (!pool || network !== "livenet" || !Number.isSafeInteger(height) || height < 1 ||
      typeof blockHash !== "string" || !/^[0-9a-f]{64}$/u.test(blockHash) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 128) return null;
  const witness = await workMailBatchDiscoveryWitness(pool, network, height);
  if (witness.blockHeight !== height || witness.blockHash !== blockHash) throw prefixUnavailable();
  const prefix = workMailBatchCoveredPrefixSql({ rebuild: "$12", snapshot: "$13", coverageHeight: "$14",
    coverageHash: "$15", height: "$3", blockHash: "$4", retainedBaseHeight: "$17" });
  const commitment = workMailBatchDeclarationCommitment();
  const result = await pool.query(`
    /* work_mail_batch_declaration_candidates */
    WITH ${prefix}, exact_transactions AS MATERIALIZED (
      SELECT DISTINCT ON (tx.txid) tx.txid, tx.block_hash, tx.block_height, tx.block_index,
        carrier.vout AS protocol_vout, carrier.output_index AS record_ordinal,
        (SELECT min(payment.vout) FROM proof_indexer.tx_outputs payment
          WHERE payment.network = tx.network AND payment.txid = tx.txid
            AND payment.address = $8 AND payment.value_sats >= 546
            AND payment.vout <> carrier.vout) AS registry_payment_vout
      FROM covered_scan scan
      JOIN proof_indexer.op_returns carrier
        ON carrier.network = $1 AND carrier.protocol = 'pwm1'
       AND carrier.payload_text = $2 AND lower(carrier.payload_hex) = $5
       AND carrier.data_bytes = $6
      JOIN proof_indexer.transactions tx
        ON tx.network = carrier.network AND tx.txid = carrier.txid
       AND tx.status = 'confirmed' AND tx.block_height <= scan.checkpoint_height
       AND tx.block_height >= $16
      JOIN proof_indexer.blocks canonical
        ON canonical.network = tx.network AND canonical.height = tx.block_height
       AND canonical.block_hash = tx.block_hash AND canonical.canonical = true
      WHERE ($9::bigint IS NULL OR
        (tx.block_height, COALESCE(tx.block_index, -1), tx.txid) > ($9::bigint, $10::integer, $11::text))
      ORDER BY tx.txid, carrier.vout, carrier.output_index
    ), candidates AS MATERIALIZED (
      SELECT * FROM exact_transactions
      ORDER BY block_height, block_index NULLS FIRST, txid
      LIMIT $7
    )
    SELECT scan.*, candidates.* FROM covered_scan scan
    LEFT JOIN candidates ON true
    ORDER BY candidates.block_height, candidates.block_index NULLS FIRST, candidates.txid
  `, [network, commitment.protocolRecord, height, blockHash,
    Buffer.from(commitment.protocolRecord).toString("hex"), commitment.protocolRecordBytes,
    limit + 1, "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV",
    after?.blockHeight ?? null, after?.blockTransactionIndex ?? null, after?.txid ?? null,
    JSON.stringify(witness.rebuild), witness.snapshotId, witness.coverageHeight, witness.coverageHash,
    WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT, witness.retainedBaseHeight]);
  const scan = result.rows[0];
  exactWorkMailBatchPrefixRow(scan, witness);
  const rows = result.rows.filter(row => row.txid);
  const overflow = rows.length > limit;
  const numberOrNull = value => value === null || value === undefined ? null : Number(value);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = overflow && Number.isSafeInteger(numberOrNull(last?.block_index)) &&
    numberOrNull(last?.block_index) >= 0 ? {
      blockHeight: Number(last.block_height), blockTransactionIndex: Number(last.block_index), txid: last.txid,
    } : null;
  return {
    candidates: page.map(row => ({
      txid: row.txid, blockHeight: Number(row.block_height), blockHash: row.block_hash,
      blockTransactionIndex: numberOrNull(row.block_index), protocolVout: numberOrNull(row.protocol_vout),
      recordOrdinal: numberOrNull(row.record_ordinal), registryPaymentVout: numberOrNull(row.registry_payment_vout),
    })),
    complete: !overflow, overflow, nextCursor,
    scan: {
      blockHash: scan.checkpoint_hash, indexedThroughBlock: Number(scan.checkpoint_height),
      tipHeight: Number(scan.checkpoint_height), complete: true,
      snapshotId: String(scan.snapshot_id), coverageIndexedThroughBlock: Number(scan.coverage_height),
      coverageBlockHash: scan.coverage_hash,
    },
    source: "proof-indexer-work-mail-batch-declaration-candidates",
  };
}

export async function assertNoSealedWorkMailBatchAuthority(pool, network, { beforeBlockHeight = null } = {}) {
  if (network !== "livenet") return;
  if (!pool || (beforeBlockHeight !== null &&
      (!Number.isSafeInteger(beforeBlockHeight) || beforeBlockHeight < 1))) {
    throw new Error("Missing WORK Mail batch marker requires an exact canonical transition boundary.");
  }
  const result = await pool.query(`
    /* work_mail_batch_missing_marker_sealed_head */
    WITH latest AS MATERIALIZED (
      SELECT transition.network, transition.block_height, transition.block_hash,
        transition.previous_block_hash, transition.complete, transition.block_atomic,
        transition.fee_once, transition.invalid_zero,
        transition.payload ? 'workMailBatchV1' AS has_batch_context
      FROM proof_indexer.work_amo_block_transitions transition
      WHERE transition.network = $1
        ${beforeBlockHeight === null ? "" : "AND transition.block_height < $2"}
      ORDER BY transition.block_height DESC
      LIMIT 1
    )
    SELECT latest.*, canonical.block_hash AS canonical_block_hash
    FROM latest
    LEFT JOIN proof_indexer.blocks canonical
      ON canonical.network = latest.network AND canonical.height = latest.block_height
     AND canonical.block_hash = latest.block_hash
     AND canonical.previous_block_hash = latest.previous_block_hash
     AND canonical.canonical = true
  `, beforeBlockHeight === null ? [network] : [network, beforeBlockHeight]);
  if (result.rows.length === 0) return;
  const row = result.rows.length === 1 ? result.rows[0] : null;
  if (!row || !Number.isSafeInteger(row.block_height) || row.block_height < 1 ||
      !/^[0-9a-f]{64}$/u.test(row.block_hash ?? "") ||
      row.canonical_block_hash !== row.block_hash ||
      row.complete !== true || row.block_atomic !== true ||
      row.fee_once !== true || row.invalid_zero !== true ||
      typeof row.has_batch_context !== "boolean" ||
      (beforeBlockHeight !== null && row.block_height >= beforeBlockHeight)) {
    throw new Error("Missing WORK Mail batch marker has unavailable or orphaned canonical transition evidence.");
  }
  if (row.has_batch_context) {
    throw new Error("Persisted WORK Mail batch activation marker is missing despite sealed canonical batch authority.");
  }
}

export async function readWorkMailBatchActivationMarker(pool, network) {
  if (network !== "livenet") return null;
  if (!pool) throw new Error("Persisted WORK Mail batch activation requires the canonical index database.");
  const result = await pool.query(`
    /* work_mail_batch_activation_marker */
    SELECT marker.value,
      canonical.block_hash AS canonical_block_hash,
      transition.payload->'transitionChainCommitment' AS transition_chain_commitment,
      transition.payload->'workMailBatchV1' AS batch_context
    FROM proof_indexer.meta marker
    LEFT JOIN proof_indexer.blocks canonical
      ON canonical.network = $1
     AND canonical.height::text = marker.value->'activationBlock'->>'height'
     AND canonical.block_hash = marker.value->'activationBlock'->>'hash'
     AND canonical.previous_block_hash = marker.value->'activationBlock'->>'previousBlockHash'
     AND canonical.canonical = true
    LEFT JOIN proof_indexer.work_amo_block_transitions transition
      ON transition.network = canonical.network AND transition.block_height = canonical.height
     AND transition.block_hash = canonical.block_hash
     AND transition.previous_block_hash = canonical.previous_block_hash
     AND transition.complete = true AND transition.block_atomic = true
     AND transition.fee_once = true AND transition.invalid_zero = true
    WHERE marker.key = $2
  `, [network, WORK_MAIL_BATCH_ACTIVATION_META_KEY]);
  if (!result.rows.length) {
    await assertNoSealedWorkMailBatchAuthority(pool, network);
    return null;
  }
  const row = result.rows.length === 1 ? result.rows[0] : null;
  const validated = validateWorkMailBatchActivationMarker(row?.value);
  const marker = validated.marker;
  const contextPins = normalizeWorkMailBatchDeclarationPins({
    ...row?.batch_context?.declaration, activationHeight: row?.batch_context?.activationHeight,
  });
  if (!validated.valid || row.canonical_block_hash !== marker.activationBlock.hash ||
      !isDeepStrictEqual(row.transition_chain_commitment, marker.activationBlock.transitionChainCommitment) ||
      !isDeepStrictEqual(contextPins, marker.declaration) ||
      !isDeepStrictEqual(row.batch_context.evidenceCommitment, marker.evidenceCommitment)) {
    throw new Error("Persisted WORK Mail batch activation is unavailable or no longer bound to its canonical transition.");
  }
  return marker;
}
