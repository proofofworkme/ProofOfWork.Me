export const WORK_Q16_PENDING_PROJECTION_MODEL =
  "canonical-work-q16-pending-projection-v3";

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

export function workQ16PendingTransactionProjectionRows(rows) {
  const projection = (Array.isArray(rows) ? rows : []).map((row) => {
    const raw = objectRecord(row?.raw_tx);
    const projected = {
      status: row?.status,
      txid: String(row?.txid ?? "").trim().toLowerCase(),
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
