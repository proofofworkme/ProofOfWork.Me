import { createHash } from "node:crypto";

export const PROOF_INDEX_MAIL_PROJECTION_PARITY_MODEL =
  "canonical-proof-index-rendered-mail-projection-parity-v1";

export const PROOF_INDEX_RENDERED_MAIL_KINDS = Object.freeze([
  "attachment",
  "browser",
  "file",
  "inception-bond",
  "infinity-bond",
  "mail",
  "reply",
]);

const RENDERED_MAIL_KIND_SET = new Set(PROOF_INDEX_RENDERED_MAIL_KINDS);
const RENDERED_EVENT_STATUSES = new Set([
  "confirmed",
  "dropped",
  "orphaned",
  "pending",
]);

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function proofIndexMailCanonicalJsonText(value) {
  return JSON.stringify(stableValue(value));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nullableText(value) {
  return value === null || value === undefined ? null : String(value);
}

function integerText(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  const text = String(value ?? "");
  return /^-?(?:0|[1-9][0-9]*)$/u.test(text)
    ? text
    : `!invalid-integer:${text}`;
}

function timestampText(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const milliseconds = value instanceof Date
    ? value.getTime()
    : Date.parse(String(value));
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : `!invalid-timestamp:${String(value)}`;
}

function normalizedText(value) {
  return String(value ?? "").trim();
}

function subjectOnlyMailBody(value) {
  return /^Subject:\s*/iu.test(normalizedText(value));
}

function mailBodyText(payload) {
  const direct = normalizedText(
    payload?.body ?? payload?.message ?? payload?.memo ?? "",
  );
  if (direct) {
    return direct;
  }
  const detail = normalizedText(payload?.detail ?? "");
  return detail && !subjectOnlyMailBody(detail) ? detail : null;
}

function mailRowKey(row) {
  return proofIndexMailCanonicalJsonText([row.network, row.txid]);
}

function transactionRowKey(row) {
  return proofIndexMailCanonicalJsonText([
    String(row?.network ?? ""),
    String(row?.txid ?? ""),
  ]);
}

function canonicalMailRow(row) {
  const source = objectRecord(row);
  return {
    amount_sats: integerText(source.amount_sats),
    body_text: nullableText(source.body_text),
    data_bytes: integerText(source.data_bytes),
    event_time: timestampText(source.event_time),
    message: objectRecord(source.message),
    network: String(source.network ?? ""),
    parent_txid: nullableText(source.parent_txid),
    sender_address: nullableText(source.sender_address),
    status: String(source.status ?? ""),
    subject: nullableText(source.subject),
    txid: String(source.txid ?? ""),
  };
}

function expectedMailRowFromEvent(row) {
  const source = objectRecord(row);
  const payload = objectRecord(source.payload);
  return canonicalMailRow({
    amount_sats: source.amount_sats,
    body_text: mailBodyText(payload),
    data_bytes: source.data_bytes,
    event_time: source.event_time,
    message: payload,
    network: source.network,
    parent_txid: payload.parentTxid ?? null,
    sender_address: payload.senderAddress ?? null,
    status: source.status,
    subject: payload.subject ?? null,
    txid: source.txid,
  });
}

export function proofIndexRenderedMailEvent(row) {
  return row?.protocol === "pwm1" &&
    row?.valid === true &&
    RENDERED_MAIL_KIND_SET.has(String(row?.kind ?? "")) &&
    RENDERED_EVENT_STATUSES.has(String(row?.status ?? ""));
}

function mailEventPayloadIdentityMismatch(event, payload) {
  const optionalTextMismatch = (key, expected, { lower = false } = {}) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      return false;
    }
    const observed = String(payload[key] ?? "");
    return lower
      ? observed.trim().toLowerCase() !== String(expected ?? "").toLowerCase()
      : observed !== String(expected ?? "");
  };
  const optionalBooleanMismatch = (key, expected) =>
    Object.prototype.hasOwnProperty.call(payload, key) &&
    (typeof payload[key] !== "boolean" || payload[key] !== expected);
  return (
    optionalTextMismatch("network", event?.network) ||
    optionalTextMismatch("txid", event?.txid, { lower: true }) ||
    optionalTextMismatch("protocol", event?.protocol, { lower: true }) ||
    optionalTextMismatch("kind", event?.kind, { lower: true }) ||
    optionalTextMismatch("status", event?.status, { lower: true }) ||
    optionalBooleanMismatch(
      "confirmed",
      event?.status === "confirmed",
    ) ||
    optionalBooleanMismatch("dropped", event?.status === "dropped")
  );
}

function transactionVolatileMailOverlay(row, expectedKeys) {
  const source = objectRecord(row);
  const rawTx = objectRecord(source.raw_tx ?? source.rawTx);
  const item = objectRecord(rawTx.item);
  const itemKind = String(item.kind ?? "").trim().toLowerCase();
  const expectedMailTransaction = expectedKeys.has(transactionRowKey(source));
  const rawMailTransaction = RENDERED_MAIL_KIND_SET.has(itemKind);
  const fields = ["indexedFrom", "item"].filter((field) =>
    Object.prototype.hasOwnProperty.call(rawTx, field)
  );
  return fields.length > 0 && (expectedMailTransaction || rawMailTransaction)
    ? {
        fields,
        network: String(source.network ?? ""),
        status: String(source.status ?? ""),
        txid: String(source.txid ?? ""),
      }
    : null;
}

function projectionSha256(label, value) {
  return createHash("sha256")
    .update(
      Buffer.from(
        `ProofOfWork.Me/PROOF-INDEX-MAIL-${label}/v1\n${
          proofIndexMailCanonicalJsonText(value)
        }`,
        "utf8",
      ),
    )
    .digest("hex");
}

export function proofIndexCanonicalMailProjectionRows(eventRows) {
  const rows = [];
  const invalid = [];
  const keys = new Set();
  for (const event of Array.isArray(eventRows) ? eventRows : []) {
    if (!proofIndexRenderedMailEvent(event)) {
      continue;
    }
    const row = expectedMailRowFromEvent(event);
    const key = mailRowKey(row);
    const eventId = String(event?.event_id ?? event?.eventId ?? "");
    const payload = objectRecord(event?.payload);
    if (
      !row.network ||
      !/^[0-9a-f]{64}$/u.test(row.txid) ||
      Object.keys(payload).length === 0 ||
      mailEventPayloadIdentityMismatch(event, payload)
    ) {
      invalid.push({ eventId, key, reason: "invalid-mail-event-identity" });
      continue;
    }
    if (keys.has(key)) {
      invalid.push({ eventId, key, reason: "duplicate-mail-event-txid" });
      continue;
    }
    keys.add(key);
    rows.push(row);
  }
  rows.sort((left, right) => compareText(mailRowKey(left), mailRowKey(right)));
  invalid.sort((left, right) =>
    compareText(
      proofIndexMailCanonicalJsonText(left),
      proofIndexMailCanonicalJsonText(right),
    )
  );
  return { invalid, rows };
}

export function proofIndexObservedMailProjectionRows(mailRows) {
  return (Array.isArray(mailRows) ? mailRows : [])
    .map(canonicalMailRow)
    .sort((left, right) => compareText(mailRowKey(left), mailRowKey(right)));
}

function differingFields(expected, observed) {
  return Object.keys(expected).filter(
    (key) =>
      proofIndexMailCanonicalJsonText(expected[key]) !==
        proofIndexMailCanonicalJsonText(observed[key]),
  );
}

export function proofIndexCanonicalMailProjectionParity({
  eventRows,
  mailRows,
  transactionRows,
} = {}) {
  const expectedProjection = proofIndexCanonicalMailProjectionRows(eventRows);
  const observed = proofIndexObservedMailProjectionRows(mailRows);
  const observedByKey = new Map();
  const duplicateObserved = [];
  for (const row of observed) {
    const key = mailRowKey(row);
    if (observedByKey.has(key)) {
      duplicateObserved.push(key);
    }
    observedByKey.set(key, row);
  }
  const expectedByKey = new Map(
    expectedProjection.rows.map((row) => [mailRowKey(row), row]),
  );
  const missing = expectedProjection.rows.filter(
    (row) => !observedByKey.has(mailRowKey(row)),
  );
  const extra = observed.filter((row) => !expectedByKey.has(mailRowKey(row)));
  const mismatched = expectedProjection.rows.flatMap((expected) => {
    const observedRow = observedByKey.get(mailRowKey(expected));
    if (!observedRow) {
      return [];
    }
    const fields = differingFields(expected, observedRow);
    return fields.length > 0
      ? [{ fields, network: expected.network, txid: expected.txid }]
      : [];
  });
  const expectedTransactionKeys = new Set(
    expectedProjection.rows.map((row) => transactionRowKey(row)),
  );
  const volatileTransactionOverlays = (Array.isArray(transactionRows)
    ? transactionRows
    : [])
    .map((row) => transactionVolatileMailOverlay(row, expectedTransactionKeys))
    .filter(Boolean)
    .sort((left, right) =>
      compareText(
        proofIndexMailCanonicalJsonText(left),
        proofIndexMailCanonicalJsonText(right),
      )
    );
  const ready =
    expectedProjection.invalid.length === 0 &&
    duplicateObserved.length === 0 &&
    missing.length === 0 &&
    extra.length === 0 &&
    mismatched.length === 0 &&
    volatileTransactionOverlays.length === 0;
  return {
    duplicateObservedCount: duplicateObserved.length,
    expectedCount: expectedProjection.rows.length,
    expectedSha256: projectionSha256("EXPECTED", expectedProjection.rows),
    extraCount: extra.length,
    extraSample: extra.slice(0, 20).map(({ network, txid }) => ({
      network,
      txid,
    })),
    extraSha256: projectionSha256("EXTRA", extra),
    invalidEventCount: expectedProjection.invalid.length,
    invalidEventSample: expectedProjection.invalid.slice(0, 20),
    invalidEventSha256: projectionSha256(
      "INVALID-EVENTS",
      expectedProjection.invalid,
    ),
    mismatchedCount: mismatched.length,
    mismatchedSample: mismatched.slice(0, 20),
    mismatchedSha256: projectionSha256("MISMATCHED", mismatched),
    missingCount: missing.length,
    missingSample: missing.slice(0, 20).map(({ network, txid }) => ({
      network,
      txid,
    })),
    missingSha256: projectionSha256("MISSING", missing),
    model: PROOF_INDEX_MAIL_PROJECTION_PARITY_MODEL,
    observedCount: observed.length,
    observedSha256: projectionSha256("OBSERVED", observed),
    ready,
    volatileTransactionOverlayCount: volatileTransactionOverlays.length,
    volatileTransactionOverlaySample: volatileTransactionOverlays.slice(0, 20),
    volatileTransactionOverlaySha256: projectionSha256(
      "VOLATILE-TRANSACTION-OVERLAYS",
      volatileTransactionOverlays,
    ),
  };
}
