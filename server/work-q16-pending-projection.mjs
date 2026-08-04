export const WORK_Q16_PENDING_PROJECTION_MODEL =
  "canonical-work-q16-pending-projection-v5";

export const WORK_Q16_PENDING_CANONICAL_SEAL_BLOCK_JOIN_SQL = `
  LEFT JOIN proof_indexer.blocks seal_block
    ON seal_block.network = seal_tx.network
   AND seal_block.block_hash = seal_tx.block_hash
   AND seal_block.height = seal_tx.block_height
   AND seal_block.canonical = true
`;

export const WORK_Q16_PENDING_CANONICAL_SEAL_PROOF_SQL = `
  seal_tx.status = 'confirmed'
  AND seal_tx.block_hash ~ '^[0-9a-f]{64}$'
  AND seal_tx.block_height IS NOT NULL
  AND seal_tx.block_height >= 0
  AND seal_tx.block_index IS NOT NULL
  AND seal_tx.block_index >= 0
  AND seal_block.block_hash IS NOT NULL
  AND jsonb_typeof(seal_tx.raw_tx) = 'object'
  AND seal_tx.raw_tx->>'txid' = seal_tx.txid
  AND jsonb_typeof(seal_tx.raw_tx->'canonicalBlockScan') = 'object'
  AND (
    SELECT array_agg(scan_key ORDER BY scan_key)
    FROM jsonb_object_keys(
      seal_tx.raw_tx->'canonicalBlockScan'
    ) AS scan_keys(scan_key)
  ) = ARRAY[
    'blockHash',
    'blockIndex',
    'height',
    'network'
  ]::text[]
  AND jsonb_typeof(
    seal_tx.raw_tx->'canonicalBlockScan'->'blockHash'
  ) = 'string'
  AND seal_tx.raw_tx->'canonicalBlockScan'->>'blockHash' =
    seal_tx.block_hash
  AND jsonb_typeof(
    seal_tx.raw_tx->'canonicalBlockScan'->'height'
  ) = 'number'
  AND seal_tx.raw_tx->'canonicalBlockScan'->>'height' =
    seal_tx.block_height::text
  AND jsonb_typeof(
    seal_tx.raw_tx->'canonicalBlockScan'->'blockIndex'
  ) = 'number'
  AND seal_tx.raw_tx->'canonicalBlockScan'->>'blockIndex' =
    seal_tx.block_index::text
  AND jsonb_typeof(
    seal_tx.raw_tx->'canonicalBlockScan'->'network'
  ) = 'string'
  AND seal_tx.raw_tx->'canonicalBlockScan'->>'network' =
    seal_tx.network
  AND jsonb_typeof(seal_tx.raw_tx->'_powBlockIndex') = 'number'
  AND seal_tx.raw_tx->>'_powBlockIndex' = seal_tx.block_index::text
`;

export const WORK_Q16_PENDING_TRANSACTION_MARKER_FIELDS = Object.freeze([
  "pendingProtocolResolvedInvalid",
  "pendingWorkMintAttemptCount",
  "pendingWorkMintInspectionVersion",
  "pendingWorkMintRecoveryNeeded",
  "pendingWorkMintResolvedInvalid",
]);

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizedIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function compareText(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function compareNullableInteger(left, right) {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function nullableText(value) {
  return value === null || value === undefined ? null : String(value);
}

function canonicalTimestampText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds)
      ? new Date(milliseconds).toISOString()
      : String(value);
  }
  return String(value);
}

function comparePendingEventIdentity(left, right) {
  return (
    compareText(left.txid, right.txid) ||
    compareText(left.protocol, right.protocol) ||
    compareNullableInteger(left.protocol_vout, right.protocol_vout) ||
    compareNullableInteger(left.record_ordinal, right.record_ordinal) ||
    compareText(left.event_id, right.event_id)
  );
}

export function workQ16PendingEventParticipantProjectionRows(rows) {
  const projection = (Array.isArray(rows) ? rows : []).map((row) => ({
    address: String(row?.address ?? ""),
    event_id: String(row?.event_id ?? ""),
    powid: String(row?.powid ?? ""),
    protocol: String(row?.protocol ?? "").trim().toLowerCase(),
    protocol_vout: normalizedIntegerOrNull(row?.protocol_vout),
    record_ordinal: normalizedIntegerOrNull(row?.record_ordinal),
    role: String(row?.role ?? ""),
    txid: String(row?.txid ?? "").trim().toLowerCase(),
  }));
  projection.sort(
    (left, right) =>
      comparePendingEventIdentity(left, right) ||
      compareText(left.address, right.address) ||
      compareText(left.role, right.role) ||
      compareText(left.powid, right.powid),
  );
  return projection;
}

export function workQ16PendingEventRefProjectionRows(rows) {
  const projection = (Array.isArray(rows) ? rows : []).map((row) => ({
    event_id: String(row?.event_id ?? ""),
    protocol: String(row?.protocol ?? "").trim().toLowerCase(),
    protocol_vout: normalizedIntegerOrNull(row?.protocol_vout),
    record_ordinal: normalizedIntegerOrNull(row?.record_ordinal),
    ref_type: String(row?.ref_type ?? ""),
    ref_value: String(row?.ref_value ?? ""),
    txid: String(row?.txid ?? "").trim().toLowerCase(),
  }));
  projection.sort(
    (left, right) =>
      comparePendingEventIdentity(left, right) ||
      compareText(left.ref_type, right.ref_type) ||
      compareText(left.ref_value, right.ref_value),
  );
  return projection;
}

export function workQ16PendingMailProjectionRows(rows) {
  const projection = (Array.isArray(rows) ? rows : []).map((row) => ({
    amount_sats: String(row?.amount_sats ?? ""),
    body_text: nullableText(row?.body_text),
    data_bytes: normalizedIntegerOrNull(row?.data_bytes),
    event_time: canonicalTimestampText(row?.event_time),
    message: row?.message,
    parent_txid: nullableText(row?.parent_txid),
    sender_address: nullableText(row?.sender_address),
    status: String(row?.status ?? ""),
    subject: nullableText(row?.subject),
    txid: String(row?.txid ?? ""),
  }));
  projection.sort((left, right) => compareText(left.txid, right.txid));
  return projection;
}

export function workQ16PendingMailProjectionParity({
  eventRows,
  mailRows,
} = {}) {
  const expectedTxids = [
    ...new Set(
      (Array.isArray(eventRows) ? eventRows : [])
        .filter(
          (row) =>
            String(row?.protocol ?? "") === "pwm1" &&
            row?.valid === true,
        )
        .map((row) => String(row?.txid ?? "")),
    ),
  ].sort(compareText);
  const observedRows = Array.isArray(mailRows) ? mailRows : [];
  const observedTxids = observedRows
    .map((row) => String(row?.txid ?? ""))
    .sort(compareText);
  const exactTxid = (txid) => /^[0-9a-f]{64}$/u.test(txid);
  return {
    expectedTxids,
    observedTxids,
    ready:
      expectedTxids.every(exactTxid) &&
      observedTxids.every(exactTxid) &&
      observedRows.every((row) => row?.status === "pending") &&
      expectedTxids.length === observedTxids.length &&
      expectedTxids.every((txid, index) => txid === observedTxids[index]),
  };
}

export function workQ16PendingTransactionVolatileOverlayAbsent(row) {
  const raw = objectRecord(row?.raw_tx);
  return !Object.prototype.hasOwnProperty.call(raw, "indexedFrom") &&
    !Object.prototype.hasOwnProperty.call(raw, "item");
}

export function workQ16PendingTransactionProjectionRows(rows) {
  const projection = (Array.isArray(rows) ? rows : []).map((row) => {
    const raw = objectRecord(row?.raw_tx);
    const projected = {
      status: row?.status,
      txid: String(row?.txid ?? "").trim().toLowerCase(),
      volatileOverlayAbsent:
        workQ16PendingTransactionVolatileOverlayAbsent(row),
    };
    for (const field of WORK_Q16_PENDING_TRANSACTION_MARKER_FIELDS) {
      projected[field] = raw[field];
    }
    return projected;
  });
  projection.sort((left, right) =>
    left.txid < right.txid ? -1 : left.txid > right.txid ? 1 : 0
  );
  return projection;
}
