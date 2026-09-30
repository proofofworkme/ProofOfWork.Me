// Confirmed chronology comes from the verified seal transaction, never a
// listing refresh, payload observation, or the listing's own confirmation.
export function canonicalSealTime(row, payload, confirmed) {
  const value = confirmed
    ? row?.seal_event_block_time ?? row?.seal_transaction_block_time
    : payload?.sealAt ?? payload?.sealedAt;
  if (value === undefined || value === null || value === "") return undefined;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toISOString() : undefined;
}
