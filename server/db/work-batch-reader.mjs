import { createHash } from "node:crypto";
import { workBatchDeclarationCommitment, WORK_BATCH_DECLARATION_ORDER_COMPATIBILITY, WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT, WORK_BATCH_ACTIVATION_META_KEY, validateWorkBatchActivationMarker, normalizeWorkBatchDeclarationPins } from "../work-batch-declaration.mjs";
import { isDeepStrictEqual } from "node:util";
import { decodeCanonicalOpReturnOutput } from "../canonical-op-return.mjs";
import { parseWorkBatchPayload, WORK_BATCH_TOKEN_ID } from "../../src/shared/protocol/workBatch.mjs";


const HASH = /^[0-9a-f]{64}$/u;
const prefixUnavailable = () => new Error("WORK batch canonical discovery prefix is unavailable or inconsistent.");

function blockScanSnapshotId(network, blockHeight, blockHash) {
  // Same identity as storeBlockScanSnapshot: a primary-key lookup, never a
  // historical snapshot search or a scan of transition JSON.
  return createHash("sha256").update(JSON.stringify({
    indexedThroughBlock: blockHeight, indexedThroughBlockHash: blockHash,
    network, source: "block-scan",
  })).digest("hex").slice(0, 24);
}

async function workBatchDiscoveryWitness(pool, network, maximumBlockHeight = null) {
  if (!pool || (maximumBlockHeight !== null &&
      (!Number.isSafeInteger(maximumBlockHeight) || maximumBlockHeight < WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT - 1))) {
    throw prefixUnavailable();
  }
  const result = await pool.query(`
    /* work_batch_discovery_state */
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
      rebuild.fromHeight > WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT ||
      rebuild.bootstrapHeight !== rebuild.fromHeight - 1 || !HASH.test(rebuild.bootstrapHash ?? "") ||
      !Number.isSafeInteger(rebuild.indexedThroughBlock) ||
      rebuild.indexedThroughBlock < WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT - 1 ||
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
      rebuild.rangeReplayFromHeight > WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT
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
function workBatchCoveredPrefixSql({ rebuild, snapshot, coverageHeight, coverageHash, height, blockHash, retainedBaseHeight }) {
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

function exactWorkBatchPrefixRow(row, witness) {
  if (!row || row.checkpoint_height !== witness.blockHeight || row.checkpoint_hash !== witness.blockHash ||
      row.coverage_height !== witness.coverageHeight || row.coverage_hash !== witness.coverageHash ||
      row.snapshot_id !== witness.snapshotId) throw prefixUnavailable();
  return row;
}

export async function readWorkBatchDiscoveryCheckpoint(pool, network, { maximumBlockHeight = null } = {}) {
  if (network !== "livenet") return null;
  const witness = await workBatchDiscoveryWitness(pool, network, maximumBlockHeight);
  const prefix = workBatchCoveredPrefixSql({ rebuild: "$2", snapshot: "$3", coverageHeight: "$4",
    coverageHash: "$5", height: "$6", blockHash: "$7", retainedBaseHeight: "$8" });
  const result = await pool.query(`/* work_batch_discovery_checkpoint */ WITH ${prefix} SELECT * FROM covered_scan`,
    [network, JSON.stringify(witness.rebuild), witness.snapshotId, witness.coverageHeight,
      witness.coverageHash, witness.blockHeight, witness.blockHash, witness.retainedBaseHeight]);
  if (result.rows.length !== 1) throw prefixUnavailable();
  exactWorkBatchPrefixRow(result.rows[0], witness);
  return { blockHeight: witness.blockHeight, blockHash: witness.blockHash, complete: true,
    source: "proof-indexer-work-batch-discovery-checkpoint" };
}

/** Exact-carrier discovery through a requested historical boundary. Raw Core
 * hydration and declaration authority checks belong to the caller; filtering
 * on stored prevouts here could hide an earlier candidate with missing data. */
export async function readWorkBatchDeclarationCandidates(pool, network, options = {}) {
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
  const witness = await workBatchDiscoveryWitness(pool, network, height);
  if (witness.blockHeight !== height || witness.blockHash !== blockHash) throw prefixUnavailable();
  const prefix = workBatchCoveredPrefixSql({ rebuild: "$12", snapshot: "$13", coverageHeight: "$14",
    coverageHash: "$15", height: "$3", blockHash: "$4", retainedBaseHeight: "$17" });
  const commitment = workBatchDeclarationCommitment();
  const result = await pool.query(`
    /* work_batch_declaration_candidates */
    WITH ${prefix}, exact_transactions AS MATERIALIZED (
      SELECT DISTINCT ON (tx.txid) tx.txid, tx.block_hash, tx.block_height, tx.block_index,
        carrier.vout AS protocol_vout, carrier.output_index AS record_ordinal,
        (SELECT min(payment.vout) FROM proof_indexer.tx_outputs payment
          WHERE payment.network = tx.network AND payment.txid = tx.txid
            AND payment.address = $8 AND payment.value_sats >= 546
            AND (payment.vout < carrier.vout OR
               (tx.txid = $18 AND payment.vout = $19 AND carrier.vout = $20
                 AND carrier.output_index = $21))) AS registry_payment_vout
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
    WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT, witness.retainedBaseHeight,
    WORK_BATCH_DECLARATION_ORDER_COMPATIBILITY.txid,
    WORK_BATCH_DECLARATION_ORDER_COMPATIBILITY.registryPaymentVout,
    WORK_BATCH_DECLARATION_ORDER_COMPATIBILITY.protocolVout,
    WORK_BATCH_DECLARATION_ORDER_COMPATIBILITY.recordOrdinal]);
  const scan = result.rows[0];
  exactWorkBatchPrefixRow(scan, witness);
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
    source: "proof-indexer-work-batch-declaration-candidates",
  };
}

export function assertCanonicalWorkBatchChild(payload, evidence) {
  const fail = () => { throw new Error("Canonical WORK batch recipient has no exact accepted parent descriptor."); };
  const parent = evidence?.parent_payload;
  const parentRecords = Array.isArray(evidence?.parent_records) ? evidence.parent_records : [];
  const parentRecord = parentRecords.length === 1 ? parentRecords[0] : null;
  const witness = payload?.workAmoV5ReplayRawWitness;
  const descriptor = witness?.descriptor;
  const decoded = decodeCanonicalOpReturnOutput(evidence?.carrier_output);
  const batch = decoded?.decodeValid === true ? parseWorkBatchPayload(decoded.text) : null;
  const index = payload?.batchRecipientIndex;
  const position = payload?.position;
  const parentPosition = parentRecord?.position;
  const commitment = parentRecord?.transitionChainCommitmentAfter;
  const storedPosition = evidence?.child_position;
  const positionFields = ["blockHeight", "blockTransactionIndex", "protocolVout", "recordOrdinal"];
  if (!storedPosition || positionFields.some(key =>
    !Number.isSafeInteger(storedPosition[key]) || storedPosition[key] < 0 ||
    storedPosition[key] !== position?.[key]
  )) fail();
  const expectedDescriptor = Number.isSafeInteger(index) ? parentRecord?.derived?.[index] : null;
  if (!batch || !Number.isSafeInteger(index) || index < 0 || index >= batch.recipientCount ||
      !parent || parent.kind !== "token-transfer-batch" || parent.protocol !== "pwt1" ||
      parent.valid !== true || parent.confirmed !== true || parent._workAmoV5ReplayBound !== true ||
      parent.workAmoV5RawCandidate !== true || parent.payload !== decoded.text ||
      parentRecord?.rawCandidate !== true || parentRecord?.outcome?.valid !== true ||
      parentRecord?.outcome?.kind !== "pwt1-valid" || parentRecord?.outcome?.semanticKind !== "token-transfer-batch" ||
      parentRecord?.output?.projection?.kind !== "token-transfer-batch" ||
      parentRecord?.derived?.length !== batch.recipientCount ||
      payload?.kind !== "token-transfer" || payload.protocol !== "pwt1" || payload.tokenId !== WORK_BATCH_TOKEN_ID ||
      payload.transferVersion !== "batch1" || payload.amountStorageModel !== "work-subatoms-v2" ||
      payload.valid !== true || payload.confirmed !== true || payload._workAmoV5ReplayBound !== true ||
      payload.workAmoV5RawCandidate !== false || payload.derived !== true || payload.rawCandidate !== false ||
      payload.chargesTransactionFee !== false || payload.claimsEconomicOutputs !== false || payload.economicDelta !== false ||
      payload.workAmoV5ReplayOutcome?.valid !== true || payload.workAmoV5ReplayOutcome?.kind !== "pwt1-valid" ||
      payload.batchRecipientCount !== batch.recipientCount || payload.batchTotalAmountSubatoms !== batch.totalAmountSubatoms ||
      payload.recipientAddress !== batch.recipients[index].recipientAddress || payload.amountSubatoms !== batch.recipients[index].amountSubatoms ||
      payload.senderAddress !== parent.senderAddress || payload.txid !== parent.txid || parentRecord?.txid !== parent.txid ||
      witness?.model !== "canonical-work-amo-v5-derived-child-v1" ||
      !descriptor || !expectedDescriptor || !isDeepStrictEqual(descriptor, expectedDescriptor) ||
      !isDeepStrictEqual(position, descriptor.projectionPosition) ||
      !isDeepStrictEqual(payload.containerPosition, parentPosition) ||
      !isDeepStrictEqual(witness.parentPosition, parentPosition) || witness.parentProtocol !== "pwt1" ||
      parentPosition?.recordOrdinal !== 0 || position?.recordOrdinal !== index + 1 ||
      !isDeepStrictEqual(payload.parentTransitionChainCommitmentAfter, commitment) ||
      !isDeepStrictEqual(descriptor.parentTransitionChainCommitmentAfter, commitment) ||
      commitment?.model !== "canonical-work-amo-raw-transition-chain-sha256-v1" ||
      !Number.isSafeInteger(commitment?.payloadBytes) || commitment.payloadBytes < 1 ||
      !/^[0-9a-f]{64}$/u.test(commitment?.sha256 ?? "") ||
      !isDeepStrictEqual(parent.workAmoV5ReplayOutput, parentRecord.output) ||
      !isDeepStrictEqual(payload.batchPayloadCommitment, parentRecord.output.batchPayloadCommitment) ||
      !isDeepStrictEqual(payload.batchPayloadCommitment, descriptor.batchPayloadCommitment) ||
      parentRecord.output.amountSubatoms !== batch.totalAmountSubatoms ||
      parentRecord.output.totalAmountSubatoms !== batch.totalAmountSubatoms ||
      parentRecord.output.recipientCount !== batch.recipientCount ||
      !isDeepStrictEqual(parentRecord.output.recipients, batch.recipients)) fail();
  for (const key of ["paidSats", "registryMutationFeeSats", "amountSats", "minerFeeSats", "creditAmountMoved", "creditValueAtConfirmSats"]) {
    if (payload[key] !== undefined && payload[key] !== 0 && payload[key] !== "0") fail();
  }
  const expectedFields = ["recipientAddress", "amountSubatoms", "senderAddress", "tokenId", "transferVersion", "batchRecipientIndex", "batchRecipientCount", "batchTotalAmountSubatoms", "derivedId"];
  if (expectedFields.some(key => payload[key] !== descriptor[key])) fail();
  return true;
}

// This read qualifies derived rows against their unique accepted parent from
// the same canonical sealed block. A batch-looking transfer cannot authorize
// itself merely by declaring a transferVersion or copying a child descriptor.
export async function verifiedWorkBatchEventIds(pool, rows, network) {
  const candidates = rows.filter(row => {
    const value = row?.payload;
    return value?.kind === "token-transfer-batch" || value?.transferVersion === "batch1" || value?.amountVersion === "batch1" || value?.batchRecipientIndex !== undefined;
  });
  const verified = new Set();
  if (!candidates.length) return verified;
  if (network !== "livenet") throw new Error("Canonical WORK batch history is mainnet only.");
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const page = candidates.slice(offset, offset + 100);
    const ids = page.map(row => Number(row.event_id));
    if (ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
      throw new Error("Canonical WORK batch history has no unique event identity.");
    }
    const result = await pool.query(`
      /* canonical_work_batch_parent_evidence */
      WITH requested_parents AS MATERIALIZED (
        SELECT DISTINCT child.network, child.txid, child.block_height, child.block_index, child.op_return_vout
        FROM proof_indexer.events child
        WHERE child.network = $1 AND child.event_id = ANY($2::bigint[])
          AND child.status = 'confirmed' AND child.valid = true
          AND child.kind IN ('token-transfer', 'token-transfer-batch') AND child.protocol = 'pwt1'
      )
      SELECT parent.event_id AS parent_event_id, parent.payload AS parent_payload,
        tx.raw_tx->'vout'->requested.op_return_vout AS carrier_output,
        (SELECT jsonb_agg(record) FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(transition.payload->'replayRecords') = 'array'
            THEN transition.payload->'replayRecords' ELSE '[]'::jsonb END
        ) record WHERE record->>'txid' = requested.txid
          AND record->>'rawCandidate' = 'true'
          AND record->'position'->>'blockHeight' = requested.block_height::text
          AND record->'position'->>'blockTransactionIndex' = requested.block_index::text
          AND record->'position'->>'protocolVout' = requested.op_return_vout::text
          AND record->'position'->>'recordOrdinal' = '0') AS parent_records,
        (SELECT jsonb_agg(jsonb_build_object(
          'event_id', sibling.event_id::text, 'payload', sibling.payload,
          'position', jsonb_build_object('blockHeight', sibling.block_height,
            'blockTransactionIndex', sibling.block_index, 'protocolVout', sibling.op_return_vout,
            'recordOrdinal', sibling.record_ordinal)
        ) ORDER BY sibling.record_ordinal)
         FROM proof_indexer.events sibling
         WHERE sibling.network = requested.network AND sibling.txid = requested.txid
           AND sibling.block_height = requested.block_height AND sibling.block_index = requested.block_index
           AND sibling.op_return_vout = requested.op_return_vout AND sibling.record_ordinal > 0
           AND sibling.status = 'confirmed' AND sibling.valid = true
           AND sibling.kind = 'token-transfer' AND sibling.protocol = 'pwt1') AS siblings
      FROM requested_parents requested
      JOIN proof_indexer.events parent ON parent.network = requested.network
        AND parent.txid = requested.txid AND parent.op_return_vout = requested.op_return_vout
        AND parent.record_ordinal = 0 AND parent.block_height = requested.block_height
        AND parent.block_index = requested.block_index AND parent.status = 'confirmed'
        AND parent.valid = true AND parent.protocol = 'pwt1' AND parent.kind = 'token-transfer-batch'
      JOIN proof_indexer.transactions tx ON tx.network = requested.network AND tx.txid = requested.txid
        AND tx.status = 'confirmed' AND tx.block_height = requested.block_height AND tx.block_index = requested.block_index
      JOIN proof_indexer.blocks block ON block.network = tx.network AND block.height = tx.block_height
        AND block.block_hash = tx.block_hash AND block.canonical = true
      JOIN proof_indexer.work_amo_block_transitions transition ON transition.network = tx.network
        AND transition.block_height = tx.block_height AND transition.block_hash = tx.block_hash
        AND transition.previous_block_hash = block.previous_block_hash
        AND transition.complete = true AND transition.block_atomic = true
        AND transition.fee_once = true AND transition.invalid_zero = true
    `, [network, ids]);
    const evidence = new Map();
    for (const row of result.rows) {
      const decoded = decodeCanonicalOpReturnOutput(row.carrier_output);
      const batch = decoded?.decodeValid === true ? parseWorkBatchPayload(decoded.text) : null;
      if (!batch || !Array.isArray(row.siblings) || row.siblings.length !== batch.recipientCount) {
        throw new Error("Canonical WORK batch recipient set is incomplete.");
      }
      const parentId = Number(row.parent_event_id);
      if (!Number.isSafeInteger(parentId) || parentId < 1 || evidence.has(parentId)) {
        throw new Error("Canonical WORK batch parent is ambiguous.");
      }
      evidence.set(parentId, row.parent_payload);
      const indexes = new Set();
      for (const sibling of row.siblings) {
        const id = Number(sibling.event_id);
        const index = sibling.payload?.batchRecipientIndex;
        if (!Number.isSafeInteger(id) || id < 1 || evidence.has(id) || indexes.has(index)) {
          throw new Error("Canonical WORK batch parent or recipient is ambiguous.");
        }
        indexes.add(index);
        assertCanonicalWorkBatchChild(sibling.payload, { ...row, child_position: sibling.position });
        evidence.set(id, sibling.payload);
      }
    }
    for (const row of page) {
      const id = Number(row.event_id);
      if (!isDeepStrictEqual(row.payload, evidence.get(id))) {
        throw new Error("Canonical WORK batch recipient read differs from its accepted parent.");
      }
      verified.add(id);
    }
  }
  return verified;
}

/**
 * A missing marker means "not activated" only when the newest existing seal has
 * no batch era. Every accepted postactivation seal carries workBatchV1, so this
 * indexed head check preserves that invariant without scanning JSON history.
 * Select before checking canonical/completeness: an orphaned or incomplete head
 * is unavailable evidence, never permission to fall back to an older seal.
 */
export async function assertNoSealedWorkBatchAuthority(pool, network, { beforeBlockHeight = null } = {}) {
  if (network !== "livenet") return;
  if (!pool || (beforeBlockHeight !== null &&
      (!Number.isSafeInteger(beforeBlockHeight) || beforeBlockHeight < 1))) {
    throw new Error("Missing WORK batch marker requires an exact canonical transition boundary.");
  }
  const result = await pool.query(`
    /* work_batch_missing_marker_sealed_head */
    WITH latest AS MATERIALIZED (
      SELECT transition.network, transition.block_height, transition.block_hash,
        transition.previous_block_hash, transition.complete, transition.block_atomic,
        transition.fee_once, transition.invalid_zero,
        transition.payload ? 'workBatchV1' AS has_batch_context
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
    throw new Error("Missing WORK batch marker has unavailable or orphaned canonical transition evidence.");
  }
  if (row.has_batch_context) {
    throw new Error("Persisted WORK batch activation marker is missing despite sealed canonical batch authority.");
  }
}

export async function readWorkBatchActivationMarker(pool, network) {
  if (network !== "livenet") return null;
  if (!pool) throw new Error("Persisted WORK batch activation requires the canonical index database.");
  const result = await pool.query(`
    /* work_batch_activation_marker */
    SELECT marker.value,
      canonical.block_hash AS canonical_block_hash,
      transition.payload->'transitionChainCommitment' AS transition_chain_commitment,
      transition.payload->'workBatchV1' AS batch_context
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
  `, [network, WORK_BATCH_ACTIVATION_META_KEY]);
  if (!result.rows.length) {
    await assertNoSealedWorkBatchAuthority(pool, network);
    return null;
  }
  const row = result.rows.length === 1 ? result.rows[0] : null;
  const validated = validateWorkBatchActivationMarker(row?.value);
  const marker = validated.marker;
  const contextPins = normalizeWorkBatchDeclarationPins({
    ...row?.batch_context?.declaration, activationHeight: row?.batch_context?.activationHeight,
  });
  if (!validated.valid || row.canonical_block_hash !== marker.activationBlock.hash ||
      !isDeepStrictEqual(row.transition_chain_commitment, marker.activationBlock.transitionChainCommitment) ||
      !isDeepStrictEqual(contextPins, marker.declaration) ||
      !isDeepStrictEqual(row.batch_context.evidenceCommitment, marker.evidenceCommitment)) {
    throw new Error("Persisted WORK batch activation is unavailable or no longer bound to its canonical transition.");
  }
  return marker;
}
