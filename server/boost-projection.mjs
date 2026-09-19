import { createHash } from "node:crypto";

const Q8 = 100_000_000n;

export function boostProjectionError(message, statusCode = 503) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = { code: statusCode === 409 ? "BOOST_CURSOR_CHANGED" : "BOOST_HISTORY_UNAVAILABLE" };
  return error;
}

export function assertBoostValuationCheckpoint(history, floor) {
  const hash = floor?.indexedThroughBlockHash ?? floor?.provenance?.indexedThroughBlockHash ?? floor?.sourceHashes?.blockScan;
  if (!floor?.snapshotId || floor.snapshotId !== history.snapshotId ||
      floor.indexedThroughBlock !== history.indexedThroughBlock ||
      hash !== history.indexedThroughBlockHash) {
    throw boostProjectionError("Boost history and WORK valuation do not share one canonical checkpoint. Refresh from page one.");
  }
}

function historyFence(page) {
  return {
    network: page.network,
    snapshotId: page.snapshotId,
    indexedThroughBlock: page.indexedThroughBlock,
    indexedThroughBlockHash: page.indexedThroughBlockHash,
    indexedAt: page.indexedAt,
    maxEventId: page.maxEventId,
    maxUpdatedAt: page.maxUpdatedAt,
    totalCount: page.totalCount,
  };
}

// The event reader validates its cursor against a repeatable-read snapshot and
// event update fence on every page. Never publish a prefix as complete state.
export async function readCompleteBoostHistory(network, readPage, { includePending = false, snapshotId = "" } = {}) {
  const params = new URLSearchParams({ limit: "200", protocol: "pwb1", status: includePending ? "all" : "confirmed" });
  if (snapshotId) params.set("snapshot", snapshotId);
  const items = [];
  const seenEvents = new Set();
  const seenCursors = new Set();
  let first;
  let fence;
  let pages = 0;
  for (;;) {
    let page;
    try { page = await readPage(network, params); }
    catch (cause) {
      if (cause?.statusCode === 409) throw cause;
      throw boostProjectionError("Canonical Boost history is temporarily unavailable.");
    }
    if (!page || page.source !== "proof-indexer-events" || page.network !== network ||
        !Array.isArray(page.items) || !page.snapshotId ||
        !Number.isSafeInteger(page.indexedThroughBlock) || page.indexedThroughBlock < 1 ||
        !/^[0-9a-f]{64}$/u.test(page.indexedThroughBlockHash ?? "") ||
        !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 ||
        !Number.isSafeInteger(page.maxEventId) || page.maxEventId < 0 ||
        typeof page.maxUpdatedAt !== "string" || !Number.isFinite(Date.parse(page.indexedAt))) {
      throw boostProjectionError("Complete canonical Boost history is unavailable.");
    }
    const currentFence = JSON.stringify(historyFence(page));
    if (snapshotId && snapshotId !== page.snapshotId) {
      throw boostProjectionError("The requested Boost checkpoint is no longer available.", 409);
    }
    if (!first) { first = page; fence = currentFence; }
    if (currentFence !== fence || page.start !== items.length ||
        page.end !== items.length + page.items.length || page.emitted !== page.end ||
        page.cursor !== (params.get("cursor") ?? "")) {
      throw boostProjectionError("Boost history changed during projection; refresh from page one.", 409);
    }
    for (const item of page.items) {
      const eventId = String(item.eventId ?? "");
      if (!/^[1-9]\d*$/u.test(eventId) || seenEvents.has(eventId)) {
        throw boostProjectionError("Boost history contains a missing or duplicate event identity.");
      }
      seenEvents.add(eventId);
      items.push(item);
    }
    pages += 1;
    if (page.hasMore === false) {
      if (page.nextCursor || items.length !== page.totalCount) {
        throw boostProjectionError("Boost history ended before its declared inventory was exhausted.");
      }
      return { ...first, items, complete: true, hasMore: false, nextCursor: "", end: items.length, emitted: items.length,
        provenance: { model: "boost-complete-events-v1", ...historyFence(first), eventCount: items.length, pages } };
    }
    if (page.hasMore !== true || !page.items.length || items.length >= page.totalCount ||
        !page.nextCursor || seenCursors.has(page.nextCursor)) {
      throw boostProjectionError("Boost history continuation did not advance.");
    }
    seenCursors.add(page.nextCursor);
    params.set("cursor", page.nextCursor);
  }
}

export function boostExactQ8(value, decimal = undefined) {
  if (value !== undefined && value !== null) {
    if (!((typeof value === "string" || typeof value === "bigint") && /^(?:0|[1-9]\d*)$/u.test(String(value)))) {
      throw boostProjectionError("Boost signal has an invalid exact Q8 value.");
    }
    const canonical = BigInt(value);
    if (decimal !== undefined && decimal !== null && boostExactQ8(undefined, decimal) !== canonical) {
      throw boostProjectionError("Boost exact signal fields disagree.");
    }
    return canonical;
  }
  const text = typeof decimal === "number" && Number.isSafeInteger(decimal) && decimal >= 0 ? String(decimal) : decimal;
  if (typeof text !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/u.test(text)) {
    throw boostProjectionError("Boost signal is missing its exact Q8 value.");
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * Q8 + BigInt(fraction.padEnd(8, "0"));
}

export function boostQ8Decimal(value) {
  const whole = value / Q8;
  const fraction = (value % Q8).toString().padStart(8, "0").replace(/0+$/u, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function compareBoostCanonicalEvents(left, right) {
  // Confirmed ownership follows physical chain order, never wall-clock time.
  for (const field of ["blockHeight", "blockIndex", "protocolVout", "recordOrdinal"]) {
    const l = Number(left?.[field]); const r = Number(right?.[field]);
    if (Number.isSafeInteger(l) && Number.isSafeInteger(r) && l !== r) return l < r ? -1 : 1;
  }
  const l = String(left?.eventId ?? left?.txid ?? "");
  const r = String(right?.eventId ?? right?.txid ?? "");
  if (/^\d+$/u.test(l) && /^\d+$/u.test(r)) return BigInt(l) < BigInt(r) ? -1 : BigInt(l) > BigInt(r) ? 1 : 0;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function boostProjectionFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function decodeBoostFeedCursor(raw) {
  if (!raw) return null;
  try {
    const text = String(raw);
    if (!text.startsWith("boost-feed-v1.")) throw new Error();
    const json = text.slice("boost-feed-v1.".length);
    const value = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
    if (Buffer.from(JSON.stringify(value)).toString("base64url") !== json ||
        !Number.isSafeInteger(value.offset) || value.offset < 1 ||
        !/^[0-9a-f]{64}$/u.test(value.fingerprint ?? "") || !value.snapshotId) throw new Error();
    return value;
  } catch { throw boostProjectionError("Invalid Boost feed cursor; refresh from page one.", 409); }
}

export function paginateBoostEntries(entries, { limit, cursor, fingerprint, snapshotId }) {
  const offset = cursor?.offset ?? 0;
  if (cursor && (cursor.fingerprint !== fingerprint || cursor.snapshotId !== snapshotId || offset >= entries.length)) {
    throw boostProjectionError("Boost feed changed after the previous page; refresh from page one.", 409);
  }
  const items = entries.slice(offset, offset + limit);
  const end = offset + items.length;
  const hasMore = end < entries.length;
  return { items, hasMore, nextCursor: hasMore ? `boost-feed-v1.${Buffer.from(JSON.stringify({ fingerprint, offset: end, snapshotId })).toString("base64url")}` : "", start: offset, end };
}

const BOOST_PAID_KINDS = new Set([
  "boost-like", "boost-reply", "boost-reboost", "boost-follow", "boost-unfollow",
  "boost-transfer", "boost-list", "boost-seal", "boost-delist", "boost-buy",
]);

export function boostNeedsRegistryHistory(items) {
  return items.some(item => item?.valid !== false && BOOST_PAID_KINDS.has(item?.kind));
}

export async function readBoostRegistryHistory(network, readPage, checkpoint) {
  const history = await readCompleteBoostHistory(network, (network, params) => {
    const registryParams = new URLSearchParams(params);
    registryParams.set("protocol", "pwid1");
    registryParams.set("refType", "powid");
    registryParams.set("ref", "boost");
    return readPage(network, registryParams);
  }, { snapshotId: checkpoint.snapshotId });
  if (history.indexedThroughBlock !== checkpoint.indexedThroughBlock ||
      history.indexedThroughBlockHash !== checkpoint.indexedThroughBlockHash) {
    throw boostProjectionError("Boost registry history and social events disagree on their checkpoint.", 409);
  }
  return history;
}

function boostPhysicalPosition(item) {
  const position = [item.blockHeight, item.blockIndex, item.protocolVout, item.recordOrdinal];
  if (position.some((value, i) => !Number.isSafeInteger(value) || value < (i === 0 ? 1 : 0))) {
    throw boostProjectionError("Boost authority history is missing an exact chain position.");
  }
  return position;
}

function boostPositionBefore(left, right) {
  const l = boostPhysicalPosition(left), r = boostPhysicalPosition(right);
  for (let i = 0; i < l.length; i++) if (l[i] !== r[i]) return l[i] < r[i];
  return false;
}

function boostExactPayments(item) {
  const payments = new Map(), outputs = new Set();
  if (!Array.isArray(item.recipients)) return null;
  for (const output of item.recipients) {
    const amount = String(output?.amountSats ?? "");
    if (!Number.isSafeInteger(output?.vout) || output.vout < 0 || outputs.has(output.vout) ||
        typeof output.address !== "string" || !output.address || !/^(?:0|[1-9]\d*)$/u.test(amount) ||
        BigInt(amount) > 2_100_000_000_000_000n) return null;
    outputs.add(output.vout);
    payments.set(output.address, (payments.get(output.address) ?? 0n) + BigInt(amount));
  }
  return payments;
}

// This qualifies application projections only. Raw events and consensus replay
// outcomes are retained unchanged; a generic accepted carrier is not proof that
// its payment reached the historical Boost receiver.
export function qualifyBoostPaidActions(items, registryItems) {
  const receivers = [];
  for (const item of [...registryItems].sort(compareBoostCanonicalEvents)) {
    if (item.confirmed !== true || item.valid !== true) continue;
    if (item.id !== "boost") throw boostProjectionError("Boost registry history contains an unrelated accepted ID.");
    if (!["id-register", "id-update", "id-transfer", "id-buy"].includes(item.kind)) continue;
    boostPhysicalPosition(item);
    const receiver = item.receiveAddress ?? item.currentReceiveAddress;
    if (typeof receiver !== "string" || !receiver.trim()) {
      throw boostProjectionError("Historical Boost receiver is unavailable.");
    }
    receivers.push({ item, receiver: receiver.trim() });
  }
  const accepted = [], rejected = [];
  for (const item of items) {
    if (!BOOST_PAID_KINDS.has(item.kind)) { accepted.push(item); continue; }
    let receiver = "";
    for (const entry of receivers) {
      if (item.confirmed === false || boostPositionBefore(entry.item, item)) receiver = entry.receiver;
      else break;
    }
    const payments = boostExactPayments(item);
    const target = String(item.targetAddress ?? item.followedAddress ?? "").trim();
    const registryDue = item.kind === "boost-follow" && target === receiver ? 1092n : 546n;
    const reason = !receiver ? "missing-confirmed-boost-receiver" : !payments ? "unverifiable-payment-outputs" :
      (payments.get(receiver) ?? 0n) < registryDue ? "boost-registry-payment-missing" :
      item.kind === "boost-follow" && (!target || (payments.get(target) ?? 0n) < 546n) ? "follow-target-payment-missing" : "";
    if (reason) rejected.push({ eventId: item.eventId, txid: item.txid, reason });
    else accepted.push({ ...item, applicationBoostRegistryReceiver: receiver });
  }
  return { accepted, rejected };
}
