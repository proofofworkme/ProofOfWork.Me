#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const NETWORK = process.env.POW_NETWORK || "livenet";
const API_BASE = (process.env.POW_API_BASE || "https://computer.proofofwork.me")
  .replace(/\/+$/u, "");
const REGISTRY_ADDRESS =
  "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const ID_REGISTRATION_PRICE_SATS = 1000;
const TX_STATUS_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.ID_AUDIT_TX_STATUS_CONCURRENCY) || 8),
);
const TXID_RE = /^[0-9a-fA-F]{64}$/u;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path, { attempt = 1, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${API_BASE}${path}`;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if ((response.status === 429 || response.status >= 500) && attempt <= 5) {
      await sleep(750 * attempt);
      return fetchJson(path, { attempt: attempt + 1, timeoutMs });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const detail = text ? `: ${text.slice(0, 240)}` : "";
      throw new Error(`${url} returned ${response.status}${detail}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function txidOf(item) {
  const txid = String(item?.txid ?? "").trim();
  return TXID_RE.test(txid) ? txid.toLowerCase() : "";
}

function normalizePowId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function safeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function amountSatsFromItem(item) {
  const direct = safeInteger(item?.amountSats);
  if (direct !== undefined) {
    return direct;
  }
  const registryPayment = Array.isArray(item?.recipients)
    ? item.recipients.find((recipient) =>
        String(recipient?.address ?? "").trim() === REGISTRY_ADDRESS
      )
    : undefined;
  return safeInteger(registryPayment?.amountSats) ?? 0;
}

function itemConfirmed(item) {
  return item?.confirmed === true || item?.status === "confirmed";
}

function itemDropped(item) {
  return item?.dropped === true || item?.status === "dropped";
}

function itemValid(item) {
  if (item?.valid === false || item?.workAmoV5RawDecodeValid === false) {
    return false;
  }
  const reasonCode = String(item?.reasonCode ?? "").trim();
  return reasonCode === "";
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

function addressesFromItem(item) {
  const participants = Array.isArray(item?.participants)
    ? item.participants
    : [];
  const inputs = Array.isArray(item?.inputAddresses) ? item.inputAddresses : [];
  return uniqueStrings([
    ...inputs,
    item?.senderAddress,
    item?.actor,
    item?.ownerAddress,
    item?.parsed?.ownerAddress,
    ...participants,
  ]).filter((address) => address !== REGISTRY_ADDRESS);
}

function attemptFromActivity(item) {
  if (String(item?.kind ?? "") !== "id-register") {
    return undefined;
  }
  const id = normalizePowId(item.id || item?.parsed?.id);
  const txid = txidOf(item);
  if (!id && !txid) {
    return undefined;
  }
  const amountSats = amountSatsFromItem(item);
  const confirmed = itemConfirmed(item);
  const dropped = itemDropped(item);
  return {
    amountSats,
    blockHash: String(item?.blockHash || item?.position?.blockHash || ""),
    blockHeight: safeInteger(item?.blockHeight ?? item?.position?.blockHeight),
    blockIndex: safeInteger(
      item?.blockIndex ?? item?.position?.blockTransactionIndex,
    ),
    confirmed,
    createdAt: String(item?.createdAt || item?.timestamp || item?.blockTime || ""),
    dropped,
    error: String(
      item?.reasonCode ||
        item?.workAmoV5RawDecodeReasonCode ||
        item?.decodeDetail ||
        "",
    ),
    eventId: safeInteger(item?.eventId),
    id,
    inputAddresses: addressesFromItem(item),
    ownerAddress: String(item?.ownerAddress || item?.parsed?.ownerAddress || ""),
    protocolVout: safeInteger(item?.protocolVout ?? item?.position?.protocolVout),
    receiveAddress: String(
      item?.receiveAddress || item?.parsed?.receiveAddress || "",
    ),
    recordOrdinal: safeInteger(item?.recordOrdinal ?? item?.position?.recordOrdinal),
    source: "ids.activity",
    status: dropped ? "dropped" : confirmed ? "confirmed" : "pending",
    txid,
    valid: itemValid(item) && amountSats === ID_REGISTRATION_PRICE_SATS,
  };
}

function attemptFromRecord(item) {
  const id = normalizePowId(item?.id);
  const txid = txidOf(item);
  if (!id && !txid) {
    return undefined;
  }
  const amountSats = amountSatsFromItem(item);
  const confirmed = itemConfirmed(item);
  const dropped = itemDropped(item);
  return {
    amountSats,
    blockHash: String(item?.blockHash || ""),
    blockHeight: safeInteger(item?.blockHeight),
    blockIndex: safeInteger(item?.blockIndex),
    confirmed,
    createdAt: String(item?.createdAt || item?.blockTime || ""),
    dropped,
    error: "",
    eventId: safeInteger(item?.registrationEventId ?? item?.eventId),
    id,
    inputAddresses: addressesFromItem(item),
    ownerAddress: String(item?.ownerAddress || ""),
    protocolVout: safeInteger(item?.protocolVout),
    receiveAddress: String(item?.receiveAddress || ""),
    recordOrdinal: safeInteger(item?.recordOrdinal),
    source: "ids.records",
    status: dropped ? "dropped" : confirmed ? "confirmed" : "pending",
    txid,
    valid: itemValid(item) && amountSats === ID_REGISTRATION_PRICE_SATS,
  };
}

function likelyRefundAddress(record) {
  return (
    record.ownerAddress ||
    record.senderAddress ||
    record.actor ||
    record.receiveAddress ||
    record.inputAddresses?.[0] ||
    ""
  );
}

function sortConfirmed(left, right) {
  return (
    (left.blockHeight ?? Number.MAX_SAFE_INTEGER) -
      (right.blockHeight ?? Number.MAX_SAFE_INTEGER) ||
    (left.blockIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.blockIndex ?? Number.MAX_SAFE_INTEGER) ||
    (left.protocolVout ?? Number.MAX_SAFE_INTEGER) -
      (right.protocolVout ?? Number.MAX_SAFE_INTEGER) ||
    (left.recordOrdinal ?? Number.MAX_SAFE_INTEGER) -
      (right.recordOrdinal ?? Number.MAX_SAFE_INTEGER) ||
    String(left.createdAt).localeCompare(String(right.createdAt)) ||
    left.txid.localeCompare(right.txid)
  );
}

function sortPending(left, right) {
  return (
    String(left.createdAt).localeCompare(String(right.createdAt)) ||
    left.txid.localeCompare(right.txid)
  );
}

function mergeAttempt(current, next) {
  return {
    ...current,
    ...next,
    amountSats: next.amountSats || current.amountSats,
    blockHash: next.blockHash || current.blockHash,
    blockHeight: next.blockHeight ?? current.blockHeight,
    blockIndex: next.blockIndex ?? current.blockIndex,
    confirmed: current.confirmed || next.confirmed,
    createdAt: next.createdAt || current.createdAt,
    dropped: current.dropped || next.dropped,
    error: next.error || current.error,
    eventId: next.eventId ?? current.eventId,
    inputAddresses: uniqueStrings([
      ...(current.inputAddresses ?? []),
      ...(next.inputAddresses ?? []),
    ]),
    ownerAddress: next.ownerAddress || current.ownerAddress,
    protocolVout: next.protocolVout ?? current.protocolVout,
    receiveAddress: next.receiveAddress || current.receiveAddress,
    recordOrdinal: next.recordOrdinal ?? current.recordOrdinal,
    source: uniqueStrings([current.source, next.source]).join("+"),
    status:
      current.dropped || next.dropped
        ? "dropped"
        : current.confirmed || next.confirmed
          ? "confirmed"
          : "pending",
    valid: current.valid && next.valid,
  };
}

function dedupeAttempts(attempts) {
  const merged = new Map();
  for (const attempt of attempts) {
    const key = attempt.txid ||
      `${attempt.id}:${attempt.createdAt}:${attempt.ownerAddress}`;
    const current = merged.get(key);
    merged.set(key, current ? mergeAttempt(current, attempt) : attempt);
  }
  return [...merged.values()];
}

function canonicalRecordMap(records) {
  const winners = new Map();
  for (const record of records) {
    const id = normalizePowId(record?.id);
    if (!id || !itemConfirmed(record) || itemDropped(record)) {
      continue;
    }
    winners.set(id, {
      eventId: safeInteger(record?.registrationEventId ?? record?.eventId),
      txid: txidOf(record),
    });
  }
  return winners;
}

function canonicalMatchesAttempt(canonical, attempt) {
  return Boolean(
    canonical &&
      ((canonical.txid && canonical.txid === attempt.txid) ||
        (canonical.eventId !== undefined && canonical.eventId === attempt.eventId)),
  );
}

function classifyAttempts(attempts, records) {
  const canonicalById = canonicalRecordMap(records);
  const attemptsById = new Map();

  for (const attempt of attempts) {
    const id = attempt.id || "(unknown)";
    const bucket = attemptsById.get(id) ?? [];
    bucket.push(attempt);
    attemptsById.set(id, bucket);
  }

  const results = [];
  for (const [id, bucket] of attemptsById) {
    const invalid = bucket
      .filter((attempt) => !attempt.valid || attempt.dropped)
      .map((attempt) => ({
        ...attempt,
        classification: attempt.confirmed
          ? "invalid_confirmed_refund_candidate"
          : "invalid_pending_watch",
        refundAddress: likelyRefundAddress(attempt),
        winnerTxid: "",
      }));
    const valid = bucket.filter((attempt) => attempt.valid && !attempt.dropped);
    const confirmed = valid.filter((attempt) => attempt.confirmed)
      .sort(sortConfirmed);
    const pending = valid.filter((attempt) => !attempt.confirmed)
      .sort(sortPending);
    const canonical = canonicalById.get(id);
    const fallbackWinner = confirmed[0];
    const winner = confirmed.find((attempt) =>
      canonicalMatchesAttempt(canonical, attempt)
    ) || fallbackWinner;

    for (const attempt of confirmed) {
      const isWinner = winner?.txid === attempt.txid;
      results.push({
        ...attempt,
        classification: isWinner
          ? "winner_confirmed"
          : "duplicate_confirmed_refund_candidate",
        refundAddress: isWinner ? "" : likelyRefundAddress(attempt),
        winnerTxid: winner?.txid || "",
      });
    }

    for (const [index, attempt] of pending.entries()) {
      const pendingCandidate =
        !winner && !canonical && index === 0;
      results.push({
        ...attempt,
        classification: pendingCandidate
          ? "pending_candidate"
          : "pending_contested_watch",
        refundAddress: pendingCandidate ? "" : likelyRefundAddress(attempt),
        winnerTxid: winner?.txid || canonical?.txid || "",
      });
    }

    results.push(...invalid);
  }

  return results.sort((left, right) =>
    left.classification.localeCompare(right.classification) ||
    left.id.localeCompare(right.id) ||
    sortConfirmed(left, right)
  );
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function txStatusMap(txids) {
  const entries = await mapConcurrent(
    txids,
    TX_STATUS_CONCURRENCY,
    async (txid) => {
      try {
        const params = new URLSearchParams({ network: NETWORK });
        const status = await fetchJson(
          `/api/v1/tx/${txid}/status?${params.toString()}`,
          { timeoutMs: 20000 },
        );
        return [txid, { ok: true, ...status }];
      } catch (error) {
        return [txid, { ok: false, error: error.message }];
      }
    },
  );
  return new Map(entries);
}

async function attachTxStatuses(records) {
  if (process.env.ID_AUDIT_VERIFY_TX_STATUS === "0") {
    return records;
  }
  const txids = [...new Set(records.map((record) => record.txid).filter(Boolean))];
  const statuses = await txStatusMap(txids);
  return records.map((record) => ({
    ...record,
    apiTxStatus: statuses.get(record.txid) ?? null,
  }));
}

function apiStatusConfirmed(status) {
  return (
    status?.confirmed === true ||
    status?.status === "confirmed" ||
    status?.tx?.status?.confirmed === true
  );
}

function apiStatusDropped(status) {
  return (
    status?.dropped === true ||
    status?.status === "dropped" ||
    status?.status === "not_found"
  );
}

function statusMismatches(records) {
  return records.filter((record) => {
    if (!record.apiTxStatus) {
      return false;
    }
    if (record.apiTxStatus.ok === false) {
      return true;
    }
    const apiConfirmed = apiStatusConfirmed(record.apiTxStatus);
    const apiDropped = apiStatusDropped(record.apiTxStatus);
    if (record.dropped) {
      return !apiDropped;
    }
    if (record.confirmed) {
      return !apiConfirmed;
    }
    return apiConfirmed || apiDropped;
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(records) {
  const headers = [
    "classification",
    "id",
    "amountSats",
    "confirmed",
    "createdAt",
    "txid",
    "winnerTxid",
    "ownerAddress",
    "receiveAddress",
    "refundAddress",
    "inputAddresses",
    "apiStatus",
    "apiConfirmed",
    "apiBlockHeight",
    "apiError",
    "error",
  ];
  const rows = records.map((record) =>
    headers
      .map((header) => {
        const value = header === "inputAddresses"
          ? (record.inputAddresses ?? []).join(" ")
          : header === "apiStatus"
            ? record.apiTxStatus?.status
            : header === "apiConfirmed"
              ? record.apiTxStatus?.confirmed
              : header === "apiBlockHeight"
                ? record.apiTxStatus?.blockHeight
                : header === "apiError"
                  ? record.apiTxStatus?.error
                  : record[header];
        return csvEscape(value);
      })
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

function printSection(title, records) {
  console.log(`\n${title}: ${records.length}`);
  for (const record of records) {
    console.log(
      [
        `- ${record.id || "(unknown id)"}`,
        record.classification,
        `${record.amountSats} sats`,
        record.confirmed ? "confirmed" : "pending",
        record.txid,
        record.refundAddress ? `refund: ${record.refundAddress}` : "",
        record.winnerTxid && record.winnerTxid !== record.txid
          ? `winner: ${record.winnerTxid}`
          : "",
        record.apiTxStatus?.status ? `api: ${record.apiTxStatus.status}` : "",
        record.apiTxStatus?.error ? `api error: ${record.apiTxStatus.error}` : "",
        record.error ? `error: ${record.error}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
}

function summarizeByRefundAddress(records) {
  const totals = new Map();
  for (const record of records) {
    if (!record.refundAddress) {
      continue;
    }
    const current = totals.get(record.refundAddress) ?? {
      address: record.refundAddress,
      ids: [],
      sats: 0,
      txids: [],
    };
    current.ids.push(record.id || "(unknown id)");
    current.sats += record.amountSats;
    current.txids.push(record.txid);
    totals.set(record.refundAddress, current);
  }
  return [...totals.values()].sort((left, right) =>
    right.sats - left.sats || left.address.localeCompare(right.address)
  );
}

function printRefundTotals(title, totals) {
  console.log(`\n${title}: ${totals.length}`);
  for (const total of totals) {
    console.log(
      `- ${total.address} | ${total.sats} sats | ${total.txids.length} txs | IDs: ${total.ids.join(", ")}`,
    );
  }
}

const params = new URLSearchParams({ network: NETWORK });
const idsPayload = await fetchJson(`/api/v1/ids?${params.toString()}`, {
  timeoutMs: 60000,
});
const records = Array.isArray(idsPayload.records) ? idsPayload.records : [];
const activity = Array.isArray(idsPayload.activity) ? idsPayload.activity : [];
const attempts = dedupeAttempts([
  ...activity.map(attemptFromActivity).filter(Boolean),
  ...records.map(attemptFromRecord).filter(Boolean),
]);
const classified = await attachTxStatuses(classifyAttempts(attempts, records));
const mismatches = statusMismatches(classified);

const refundCandidates = classified.filter((record) =>
  record.classification.endsWith("_refund_candidate")
);
const pendingWatch = classified.filter((record) =>
  record.classification.endsWith("_watch")
);
const winners = classified.filter((record) =>
  record.classification === "winner_confirmed"
);
const pendingCandidates = classified.filter((record) =>
  record.classification === "pending_candidate"
);
const refundTotalsByAddress = summarizeByRefundAddress(refundCandidates);
const pendingWatchTotalsByAddress = summarizeByRefundAddress(pendingWatch);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = `/tmp/proofofwork-id-registry-audit-${timestamp}.json`;
const csvPath = `/tmp/proofofwork-id-registry-audit-${timestamp}.csv`;

await writeFile(
  jsonPath,
  JSON.stringify(
    {
      apiBase: API_BASE,
      auditedAt: new Date().toISOString(),
      indexedAt: idsPayload.indexedAt,
      indexedThroughBlock: idsPayload.indexedThroughBlock,
      network: NETWORK,
      registryAddress: idsPayload.registryAddress || REGISTRY_ADDRESS,
      snapshotId: idsPayload.snapshotId,
      source: idsPayload.source,
      statusMismatches: mismatches,
      totals: {
        activityItems: activity.length,
        apiStats: idsPayload.stats ?? null,
        pendingCandidates: pendingCandidates.length,
        pendingWatch: pendingWatch.length,
        records: records.length,
        refundCandidates: refundCandidates.length,
        registrationAttempts: attempts.length,
        statusMismatches: mismatches.length,
        winners: winners.length,
      },
      refundCandidates,
      refundTotalsByAddress,
      pendingWatch,
      pendingWatchTotalsByAddress,
      winners,
      pendingCandidates,
      allClassifiedAttempts: classified,
    },
    null,
    2,
  ),
);
await writeFile(
  csvPath,
  toCsv([...refundCandidates, ...pendingWatch, ...pendingCandidates, ...winners]),
);

console.log("ProofOfWork ID registry audit");
console.log(`API: ${API_BASE}`);
console.log(`Registry: ${idsPayload.registryAddress || REGISTRY_ADDRESS}`);
console.log(`Network: ${NETWORK}`);
console.log(`Snapshot: ${idsPayload.snapshotId || "(unknown)"}`);
console.log(`Indexed through block: ${idsPayload.indexedThroughBlock ?? "(unknown)"}`);
console.log(`Activity items: ${activity.length}`);
console.log(`Records: ${records.length}`);
console.log(`Registration attempts: ${attempts.length}`);
console.log(`Confirmed winners: ${winners.length}`);
console.log(`Pending candidates: ${pendingCandidates.length}`);
console.log(`Refund candidates: ${refundCandidates.length}`);
console.log(`Pending watchlist: ${pendingWatch.length}`);
console.log(`Tx-status mismatches: ${mismatches.length}`);

printSection("Refund candidates", refundCandidates);
printRefundTotals("Refund totals by address", refundTotalsByAddress);
printSection("Pending watchlist", pendingWatch);
printRefundTotals("Pending watch totals by address", pendingWatchTotalsByAddress);
printSection("Tx-status mismatches", mismatches);

console.log(`\nJSON report: ${jsonPath}`);
console.log(`CSV report: ${csvPath}`);
