import { isDeepStrictEqual } from "node:util";
import { decodeCanonicalOpReturnOutput, canonicalRawProtocolRecordSetFromTransaction } from "../canonical-op-return.mjs";
import { parseWorkMailBatchPayload, WORK_MAIL_BATCH_TOKEN_ID } from "../../src/shared/protocol/workMailBatch.mjs";
import { validateWorkMailBatchV1TransactionShape } from "../work-mail-batch-transaction.mjs";
import { normalizeWorkMailBatchDeclarationPins, WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL } from "../work-mail-batch-declaration.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "../work-amo-v5.mjs";

// Accepted native parent/ordinary PWM witnesses plus ALL child rows are required.
// This function never grants authority to a decoded carrier or standalone child.
export function validateWorkMailBatchProjectionEvents({ parent, children, parentRecord, mailRecord, transaction, activationContext } = {}) {
  const invalid = () => ({ valid: false, reasonCode: "Canonical WORK Mail batch parent, Mail or recipient evidence disagrees." });
  try {
    const position = parentRecord?.position;
    const shape = validateWorkMailBatchV1TransactionShape({ transaction, protocolVout: position?.protocolVout,
      recordOrdinal: position?.recordOrdinal, senderAddress: parent?.senderAddress });
    if (!shape.valid) return invalid();
    const { parsed, mailEnvelope } = shape;
    const pins = normalizeWorkMailBatchDeclarationPins({ ...activationContext?.declaration, activationHeight: activationContext?.activationHeight });
    const authority = activationContext?.evidenceCommitment;
    const records = canonicalRawProtocolRecordSetFromTransaction(transaction).records;
    const mail = records.find(row => row.protocol === "pwm1"), carrier = records.find(row => row.protocolVout === position.protocolVout);
    const sameBlock = other => ["blockHeight", "blockHash", "blockTransactionIndex"].every(key => other?.[key] === position[key]);
    const commitment = workAmoV5CanonicalPayloadCommitment({ payload: carrier.message });
    if (!pins || position.blockHeight < pins.activationHeight || authority?.model !== WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL ||
        !/^[0-9a-f]{64}$/u.test(authority?.sha256 ?? "") || !Number.isSafeInteger(authority?.payloadBytes) || authority.payloadBytes < 1 ||
        parent?.confirmed !== true || parent.valid !== true || parent.kind !== "token-transfer-batch" || parent.protocol !== "pwt1" ||
        parent.transferVersion !== "mailbatch1" || parent.amountVersion !== "mailbatch1" || parent.tokenId !== WORK_MAIL_BATCH_TOKEN_ID ||
        parent.txid !== transaction.txid || parentRecord?.txid !== transaction.txid || parentRecord.protocol !== "pwt1" ||
        parentRecord.rawCandidate !== true || parentRecord.outcome?.valid !== true || parentRecord.outcome?.semanticKind !== "token-transfer-batch" ||
        !isDeepStrictEqual(parent.workAmoV5ReplayOutput, parentRecord.output) ||
        !isDeepStrictEqual(parentRecord.rawWitness?.rawRecordParts, carrier.rawRecordParts) ||
        !isDeepStrictEqual(parentRecord.output?.batchPayloadCommitment, commitment) ||
        !isDeepStrictEqual(parentRecord.output?.mailEnvelope, mailEnvelope) || !isDeepStrictEqual(parent.mailEnvelope, mailEnvelope) ||
        parentRecord.output?.batchRegistryPaymentSats !== 546 || parent.paidSats !== 546 ||
        mailRecord?.txid !== parent.txid || mailRecord.protocol !== "pwm1" || mailRecord.rawCandidate !== true ||
        mailRecord.outcome?.valid !== true || mailRecord.outcome?.semanticKind !== mailEnvelope.kind || !sameBlock(mailRecord.position) ||
        mailRecord.position.protocolVout !== mailEnvelope.protocolVout || mailRecord.position.recordOrdinal !== 0 ||
        !isDeepStrictEqual(mailRecord.rawWitness?.rawRecordParts, mail.rawRecordParts) ||
        !isDeepStrictEqual(mailRecord.output?.recipients, mailEnvelope.recipients.map(({ recipientAddress, amountSats, vout }) =>
          ({ address: recipientAddress, amountSats, outputSats: amountSats, vout }))) ||
        !Array.isArray(children) || children.length !== parsed.recipientCount ||
        parentRecord.derived?.length !== parsed.recipientCount) return invalid();
    const seen = new Set();
    for (const child of children) {
      if (seen.has(child?.batchRecipientIndex)) return invalid();
      seen.add(child?.batchRecipientIndex);
      assertCanonicalWorkMailBatchChild(child, { parent_payload: parent, parent_records: [parentRecord],
        carrier_output: transaction.vout[position.protocolVout], child_position: child.position });
    }
    return { valid: true, reasonCode: "", parsed, mailEnvelope };
  } catch { return invalid(); }
}

export function assertCanonicalWorkMailBatchChild(payload, evidence) {
  const fail = () => { throw new Error("Canonical WORK Mail batch recipient has no exact accepted parent descriptor."); };
  const parent = evidence?.parent_payload;
  const parentRecords = Array.isArray(evidence?.parent_records) ? evidence.parent_records : [];
  const parentRecord = parentRecords.length === 1 ? parentRecords[0] : null;
  const witness = payload?.workAmoV5ReplayRawWitness;
  const descriptor = witness?.descriptor;
  const decoded = decodeCanonicalOpReturnOutput(evidence?.carrier_output);
  const batch = decoded?.decodeValid === true ? parseWorkMailBatchPayload(decoded.text) : null;
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
      payload?.kind !== "token-transfer" || payload.protocol !== "pwt1" || payload.tokenId !== WORK_MAIL_BATCH_TOKEN_ID ||
      payload.transferVersion !== "mailbatch1" || payload.amountStorageModel !== "work-subatoms-v2" ||
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
      !isDeepStrictEqual(payload.mailEnvelope, parentRecord.output.mailEnvelope) ||
      !isDeepStrictEqual(payload.mailEnvelope, descriptor.mailEnvelope) ||
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
export async function verifiedWorkMailBatchEventIds(pool, rows, network = "livenet") {
  const candidates = rows.filter(row => {
    const value = row?.payload;
    return value?.transferVersion === "mailbatch1" || value?.amountVersion === "mailbatch1" || String(value?.payload ?? "").startsWith("pwt1:mailbatch1:");
  });
  const verified = new Set();
  if (!candidates.length) return verified;
  if (network !== "livenet") throw new Error("Canonical WORK Mail batch history is mainnet only.");
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const page = candidates.slice(offset, offset + 100);
    const ids = page.map(row => Number(row.event_id));
    if (ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
      throw new Error("Canonical WORK Mail batch history has no unique event identity.");
    }
    const result = await pool.query(`
      /* canonical_work_mail_batch_parent_evidence */
      WITH requested_parents AS MATERIALIZED (
        SELECT DISTINCT child.network, child.txid, child.block_height, child.block_index, child.op_return_vout
        FROM proof_indexer.events child
        WHERE child.network = $1 AND child.event_id = ANY($2::bigint[])
          AND child.status = 'confirmed' AND child.valid = true
          AND child.kind IN ('token-transfer', 'token-transfer-batch') AND child.protocol = 'pwt1'
          AND child.payload->>'transferVersion' = 'mailbatch1'
      )
      SELECT parent.event_id AS parent_event_id, parent.payload AS parent_payload,
        tx.raw_tx->'vout'->requested.op_return_vout AS carrier_output,
        tx.raw_tx || jsonb_build_object('txid', tx.txid) AS transaction,
        transition.payload->'workMailBatchV1' AS activation_context,
        (SELECT jsonb_agg(record) FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(transition.payload->'replayRecords') = 'array'
            THEN transition.payload->'replayRecords' ELSE '[]'::jsonb END
        ) record WHERE record->>'txid' = requested.txid AND record->>'protocol' = 'pwm1'
          AND record->>'rawCandidate' = 'true') AS mail_records,
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
        AND parent.payload->>'transferVersion' = 'mailbatch1'
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
      const batch = decoded?.decodeValid === true ? parseWorkMailBatchPayload(decoded.text) : null;
      if (!batch || !Array.isArray(row.siblings) || row.siblings.length !== batch.recipientCount) {
        throw new Error("Canonical WORK Mail batch recipient set is incomplete.");
      }
      const qualification = validateWorkMailBatchProjectionEvents({ parent: row.parent_payload,
        children: row.siblings.map(sibling => sibling.payload),
        parentRecord: row.parent_records?.length === 1 ? row.parent_records[0] : null,
        mailRecord: row.mail_records?.length === 1 ? row.mail_records[0] : null,
        transaction: row.transaction, activationContext: row.activation_context });
      if (!qualification.valid) throw new Error(qualification.reasonCode);
      const parentId = Number(row.parent_event_id);
      if (!Number.isSafeInteger(parentId) || parentId < 1 || evidence.has(parentId)) {
        throw new Error("Canonical WORK Mail batch parent is ambiguous.");
      }
      evidence.set(parentId, row.parent_payload);
      const indexes = new Set();
      for (const sibling of row.siblings) {
        const id = Number(sibling.event_id);
        const index = sibling.payload?.batchRecipientIndex;
        if (!Number.isSafeInteger(id) || id < 1 || evidence.has(id) || indexes.has(index)) {
          throw new Error("Canonical WORK Mail batch parent or recipient is ambiguous.");
        }
        indexes.add(index);
        assertCanonicalWorkMailBatchChild(sibling.payload, { ...row, child_position: sibling.position });
        evidence.set(id, sibling.payload);
      }
    }
    for (const row of page) {
      const id = Number(row.event_id);
      if (!isDeepStrictEqual(row.payload, evidence.get(id))) {
        throw new Error("Canonical WORK Mail batch recipient read differs from its accepted parent.");
      }
      verified.add(id);
    }
  }
  return verified;
}
