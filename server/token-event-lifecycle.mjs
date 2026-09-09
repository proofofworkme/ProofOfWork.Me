// A retained terminal attempt is history, never pending balance or activity.
// Legacy in-memory replay records may omit status; their explicit unconfirmed
// boolean remains supported until the durable lifecycle has been attached.
export function tokenEventIsPending(record) {
  if (!record || record.confirmed !== false || record.valid === false ||
      record.dropped === true || record.orphaned === true) return false;
  const status = String(record.status ?? "").trim().toLowerCase();
  return status === "pending" || status === "";
}
