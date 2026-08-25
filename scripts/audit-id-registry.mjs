#!/usr/bin/env node

import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { writeFile } from "node:fs/promises";

bitcoin.initEccLib(ecc);

const NETWORK = "livenet";
const MEMPOOL_BASE = "https://mempool.space";
const REGISTRY_ADDRESS = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const ID_PROTOCOL_PREFIX = "pwid1:";
const ID_REGISTRATION_PRICE_SATS = 1000;
const MAX_REGISTRY_TX_PAGES = 100;
const BLOCK_TXID_INDEX_CACHE = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url);
  if (response.status === 429 && attempt <= 5) {
    const waitMs = 750 * attempt;
    await sleep(waitMs);
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

async function fetchAddressTransactionsPage(path) {
  const transactions = await fetchJson(`${MEMPOOL_BASE}/api/address/${REGISTRY_ADDRESS}/${path}`);
  return Array.isArray(transactions) ? transactions : [];
}

function transactionTxid(tx) {
  return typeof tx.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(tx.txid) ? tx.txid.toLowerCase() : "";
}

function transactionConfirmed(tx) {
  return Boolean(tx.status?.confirmed);
}

function transactionBlockHash(tx) {
  const blockHash = tx.status?.block_hash;
  return typeof blockHash === "string" && /^[0-9a-fA-F]{64}$/u.test(blockHash) ? blockHash.toLowerCase() : "";
}

function transactionBlockHeight(tx) {
  const height = tx.status?.block_height;
  return Number.isSafeInteger(height) && height >= 0 ? height : undefined;
}

function transactionBlockIndex(tx) {
  const index = tx._powBlockIndex ?? tx.status?.block_index ?? tx.status?.block_tx_index;
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

async function fetchBlockTxidIndex(blockHash) {
  if (!/^[0-9a-fA-F]{64}$/u.test(blockHash)) {
    return new Map();
  }

  const normalizedHash = blockHash.toLowerCase();
  if (!BLOCK_TXID_INDEX_CACHE.has(normalizedHash)) {
    const promise = fetchJson(`${MEMPOOL_BASE}/api/block/${normalizedHash}/txids`)
      .then((txids) => {
        const index = new Map();
        if (Array.isArray(txids)) {
          txids.forEach((txid, position) => {
            if (typeof txid === "string" && /^[0-9a-fA-F]{64}$/u.test(txid)) {
              index.set(txid.toLowerCase(), position);
            }
          });
        }
        return index;
      })
      .catch((error) => {
        BLOCK_TXID_INDEX_CACHE.delete(normalizedHash);
        throw error;
      });
    BLOCK_TXID_INDEX_CACHE.set(normalizedHash, promise);
  }

  return BLOCK_TXID_INDEX_CACHE.get(normalizedHash);
}

async function annotateBlockOrder(txs) {
  const blockCounts = new Map();
  for (const tx of txs) {
    if (!transactionConfirmed(tx)) {
      continue;
    }

    const blockHash = transactionBlockHash(tx);
    if (blockHash) {
      blockCounts.set(blockHash, (blockCounts.get(blockHash) ?? 0) + 1);
    }
  }

  const blockHashes = [...blockCounts].filter(([, count]) => count > 1).map(([blockHash]) => blockHash);

  if (blockHashes.length === 0) {
    return txs;
  }

  const blockIndexes = new Map();
  await Promise.all(
    blockHashes.map(async (blockHash) => {
      const index = await fetchBlockTxidIndex(blockHash).catch(() => null);
      if (index) {
        blockIndexes.set(blockHash, index);
      }
    }),
  );

  if (blockIndexes.size === 0) {
    return txs;
  }

  return txs.map((tx) => {
    const txid = transactionTxid(tx);
    const blockHash = transactionBlockHash(tx);
    const index = blockIndexes.get(blockHash)?.get(txid);
    return Number.isSafeInteger(index) ? { ...tx, _powBlockIndex: index } : tx;
  });
}

function oldestConfirmedTxid(txs) {
  const confirmedTxs = txs.filter(transactionConfirmed);
  return confirmedTxs.length > 0 ? transactionTxid(confirmedTxs[confirmedTxs.length - 1]) : "";
}

function dedupeTransactions(txs) {
  const merged = new Map();

  for (const tx of txs) {
    const txid = transactionTxid(tx);
    if (!txid) {
      continue;
    }

    const current = merged.get(txid);
    if (!current || (transactionConfirmed(tx) && !transactionConfirmed(current))) {
      merged.set(txid, tx);
    }
  }

  return [...merged.values()];
}

async function fetchRegistryTransactions() {
  const recentTxs = await fetchAddressTransactionsPage("txs");
  const mempoolTxs = await fetchAddressTransactionsPage("txs/mempool");

  let chainPage = [];
  try {
    chainPage = await fetchAddressTransactionsPage("txs/chain");
  } catch {
    chainPage = recentTxs.filter(transactionConfirmed);
  }

  if (chainPage.length === 0) {
    chainPage = recentTxs.filter(transactionConfirmed);
  }

  const chainTxs = [...chainPage];
  const cursors = new Set();
  let cursor = oldestConfirmedTxid(chainPage);

  for (let page = 0; cursor && page < MAX_REGISTRY_TX_PAGES; page += 1) {
    if (cursors.has(cursor)) {
      break;
    }

    cursors.add(cursor);
    const nextPage = await fetchAddressTransactionsPage(`txs/chain/${cursor}`);
    if (nextPage.length === 0) {
      break;
    }

    chainTxs.push(...nextPage);
    cursor = oldestConfirmedTxid(nextPage);
  }

  const txs = dedupeTransactions([...chainTxs, ...mempoolTxs, ...recentTxs]);
  return annotateBlockOrder(txs);
}

function decodeHex(hex) {
  if (!hex || hex.length % 2 !== 0) {
    return "";
  }

  return Buffer.from(hex, "hex").toString("utf8");
}

function decodedOpReturnMessages(vout) {
  return vout
    .filter((output) => output.scriptpubkey_type === "op_return")
    .map((output) => String(output.scriptpubkey_asm ?? ""))
    .map((asm) =>
      asm
        .split(" ")
        .slice(1)
        .filter((token) => /^[0-9a-fA-F]+$/u.test(token))
        .map(decodeHex)
        .join(""),
    )
    .filter(Boolean);
}

function decodedProtocolMessages(vout, prefix) {
  return decodedOpReturnMessages(vout).filter((message) => message.startsWith(prefix));
}

function firstIdProtocolOutputIndex(vout) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], ID_PROTOCOL_PREFIX).length > 0;
  });
}

function registryPaymentAmount(vout) {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  const paymentOutput = vout.find((output, index) => {
    return (
      output.scriptpubkey_address === REGISTRY_ADDRESS &&
      typeof output.value === "number" &&
      output.value >= ID_REGISTRATION_PRICE_SATS &&
      (protocolIndex === -1 || index < protocolIndex)
    );
  });

  return typeof paymentOutput?.value === "number" ? paymentOutput.value : 0;
}

function base64FromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function decodeTextBase64Url(value) {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("Invalid base64url data.");
  }

  return Buffer.from(base64FromBase64Url(value), "base64").toString("utf8");
}

function normalizePowId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "")
    .trim();
}

function isValidBitcoinAddress(address) {
  try {
    bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);
    return true;
  } catch {
    return false;
  }
}

function parseIdRegistrationPayload(payload) {
  let rawId = "";
  let ownerAddress = "";
  let receiveAddress = "";
  let pgpEncoded = "";

  if (payload.startsWith("r2:")) {
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return { error: "bad_r2_field_count" };
    }

    const [, idEncoded, owner, receiver, pgp] = parts;
    try {
      rawId = decodeTextBase64Url(idEncoded);
    } catch {
      return { error: "bad_id_base64url" };
    }

    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else if (payload.startsWith("r:")) {
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return { error: "bad_legacy_field_count" };
    }

    const [, id, owner, receiver, pgp] = parts;
    rawId = id;
    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else {
    return { error: "not_registration_event" };
  }

  const id = normalizePowId(rawId);
  if (!id) {
    return { error: "empty_id" };
  }

  if (!isValidBitcoinAddress(ownerAddress)) {
    return { error: "invalid_owner_address", id };
  }

  if (!isValidBitcoinAddress(receiveAddress)) {
    return { error: "invalid_receive_address", id, ownerAddress };
  }

  let pgpKey = "";
  if (pgpEncoded) {
    try {
      pgpKey = decodeTextBase64Url(pgpEncoded).trim();
    } catch {
      return { error: "bad_pgp_base64url", id, ownerAddress, receiveAddress };
    }
  }

  return {
    id,
    ownerAddress,
    pgpKey,
    receiveAddress,
  };
}

function txCreatedAt(tx) {
  const blockTime = typeof tx.status?.block_time === "number" ? tx.status.block_time * 1000 : Date.now();
  return new Date(blockTime).toISOString();
}

function sortConfirmed(left, right) {
  const leftHeight = Number.isSafeInteger(left.blockHeight) ? left.blockHeight : Number.POSITIVE_INFINITY;
  const rightHeight = Number.isSafeInteger(right.blockHeight) ? right.blockHeight : Number.POSITIVE_INFINITY;
  if (leftHeight !== rightHeight) {
    return leftHeight - rightHeight;
  }

  const leftIndex = Number.isSafeInteger(left.blockIndex) ? left.blockIndex : Number.POSITIVE_INFINITY;
  const rightIndex = Number.isSafeInteger(right.blockIndex) ? right.blockIndex : Number.POSITIVE_INFINITY;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.txid.localeCompare(right.txid);
}

function sortPending(left, right) {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.txid.localeCompare(right.txid);
}

function inputAddresses(vin) {
  return [
    ...new Set(
      vin
        .map((input) => input?.prevout?.scriptpubkey_address)
        .filter((address) => typeof address === "string" && address.length > 0),
    ),
  ];
}

function likelyRefundAddress(record) {
  if (record.ownerAddress) {
    return record.ownerAddress;
  }

  if (record.inputAddresses.length === 1) {
    return record.inputAddresses[0];
  }

  return record.inputAddresses.join(", ");
}

function extractAuditAttempts(txs) {
  return txs.flatMap((tx) => {
    const txid = transactionTxid(tx);
    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const amountSats = registryPaymentAmount(vout);
    const confirmed = transactionConfirmed(tx);
    const createdAt = txCreatedAt(tx);
    const payerInputAddresses = inputAddresses(vin);
    const blockHeight = transactionBlockHeight(tx);
    const blockIndex = transactionBlockIndex(tx);

    if (!txid || amountSats < ID_REGISTRATION_PRICE_SATS) {
      return [];
    }

    const registerMessage = decodedProtocolMessages(vout, ID_PROTOCOL_PREFIX)
      .map((message) => message.slice(ID_PROTOCOL_PREFIX.length))
      .find((payload) => payload.startsWith("r2:") || payload.startsWith("r:"));

    if (!registerMessage) {
      return [
        {
          amountSats,
          blockHeight,
          blockIndex,
          classification: "invalid",
          confirmed,
          createdAt,
          error: "missing_registration_op_return",
          id: "",
          inputAddresses: payerInputAddresses,
          ownerAddress: "",
          receiveAddress: "",
          refundAddress: payerInputAddresses.length === 1 ? payerInputAddresses[0] : payerInputAddresses.join(", "),
          txid,
        },
      ];
    }

    const parsed = parseIdRegistrationPayload(registerMessage);
    if (parsed.error) {
      return [
        {
          amountSats,
          blockHeight,
          blockIndex,
          classification: "invalid",
          confirmed,
          createdAt,
          error: parsed.error,
          id: parsed.id ?? "",
          inputAddresses: payerInputAddresses,
          ownerAddress: parsed.ownerAddress ?? "",
          receiveAddress: parsed.receiveAddress ?? "",
          refundAddress: parsed.ownerAddress ?? (payerInputAddresses.length === 1 ? payerInputAddresses[0] : payerInputAddresses.join(", ")),
          txid,
        },
      ];
    }

    return [
      {
        amountSats,
        blockHeight,
        blockIndex,
        classification: "valid",
        confirmed,
        createdAt,
        error: "",
        id: parsed.id,
        inputAddresses: payerInputAddresses,
        ownerAddress: parsed.ownerAddress,
        receiveAddress: parsed.receiveAddress,
        refundAddress: "",
        txid,
      },
    ];
  });
}

function classifyAttempts(attempts) {
  const valid = attempts.filter((attempt) => attempt.classification === "valid");
  const confirmed = valid.filter((attempt) => attempt.confirmed).sort(sortConfirmed);
  const pending = valid.filter((attempt) => !attempt.confirmed).sort(sortPending);
  const winnersById = new Map();
  const results = [];

  for (const record of confirmed) {
    const winner = winnersById.get(record.id);
    if (!winner) {
      winnersById.set(record.id, record);
      results.push({
        ...record,
        classification: "winner_confirmed",
        refundAddress: "",
        winnerTxid: record.txid,
      });
      continue;
    }

    results.push({
      ...record,
      classification: "duplicate_confirmed_refund_candidate",
      refundAddress: likelyRefundAddress(record),
      winnerTxid: winner.txid,
    });
  }

  const pendingById = new Map();
  for (const record of pending) {
    const winner = winnersById.get(record.id);
    if (winner) {
      results.push({
        ...record,
        classification: "duplicate_pending_watch",
        refundAddress: likelyRefundAddress(record),
        winnerTxid: winner.txid,
      });
      continue;
    }

    const existingPending = pendingById.get(record.id);
    if (!existingPending) {
      pendingById.set(record.id, record);
      results.push({
        ...record,
        classification: "pending_candidate",
        refundAddress: "",
        winnerTxid: "",
      });
      continue;
    }

    results.push({
      ...record,
      classification: "pending_contested_watch",
      refundAddress: likelyRefundAddress(record),
      winnerTxid: existingPending.txid,
    });
  }

  const invalid = attempts
    .filter((attempt) => attempt.classification === "invalid")
    .map((record) => ({
      ...record,
      classification: record.confirmed ? "invalid_confirmed_refund_candidate" : "invalid_pending_watch",
      winnerTxid: "",
    }));

  return [...results, ...invalid];
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
    "error",
  ];
  const rows = records.map((record) =>
    headers
      .map((header) => {
        const value = header === "inputAddresses" ? record.inputAddresses.join(" ") : record[header];
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
        record.winnerTxid && record.winnerTxid !== record.txid ? `winner: ${record.winnerTxid}` : "",
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

  return [...totals.values()].sort((left, right) => right.sats - left.sats || left.address.localeCompare(right.address));
}

function printRefundTotals(title, totals) {
  console.log(`\n${title}: ${totals.length}`);
  for (const total of totals) {
    console.log(`- ${total.address} | ${total.sats} sats | ${total.txids.length} txs | IDs: ${total.ids.join(", ")}`);
  }
}

const txs = await fetchRegistryTransactions();
const attempts = extractAuditAttempts(txs);
const classified = classifyAttempts(attempts);

const refundCandidates = classified.filter((record) => record.classification.endsWith("_refund_candidate"));
const pendingWatch = classified.filter((record) => record.classification.endsWith("_watch"));
const winners = classified.filter((record) => record.classification === "winner_confirmed");
const pendingCandidates = classified.filter((record) => record.classification === "pending_candidate");
const refundTotalsByAddress = summarizeByRefundAddress(refundCandidates);
const pendingWatchTotalsByAddress = summarizeByRefundAddress(pendingWatch);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = `/tmp/proofofwork-id-registry-audit-${timestamp}.json`;
const csvPath = `/tmp/proofofwork-id-registry-audit-${timestamp}.csv`;

await writeFile(
  jsonPath,
  JSON.stringify(
    {
      auditedAt: new Date().toISOString(),
      registryAddress: REGISTRY_ADDRESS,
      network: NETWORK,
      totals: {
        fetchedTransactions: txs.length,
        registrationAttempts: attempts.length,
        winners: winners.length,
        pendingCandidates: pendingCandidates.length,
        refundCandidates: refundCandidates.length,
        pendingWatch: pendingWatch.length,
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
await writeFile(csvPath, toCsv([...refundCandidates, ...pendingWatch, ...pendingCandidates, ...winners]));

console.log("ProofOfWork ID registry audit");
console.log(`Registry: ${REGISTRY_ADDRESS}`);
console.log(`Fetched transactions: ${txs.length}`);
console.log(`Registration attempts: ${attempts.length}`);
console.log(`Confirmed winners: ${winners.length}`);
console.log(`Pending candidates: ${pendingCandidates.length}`);
console.log(`Refund candidates: ${refundCandidates.length}`);
console.log(`Pending watchlist: ${pendingWatch.length}`);

printSection("Refund candidates", refundCandidates);
printRefundTotals("Refund totals by address", refundTotalsByAddress);
printSection("Pending watchlist", pendingWatch);
printRefundTotals("Pending watch totals by address", pendingWatchTotalsByAddress);

console.log(`\nJSON report: ${jsonPath}`);
console.log(`CSV report: ${csvPath}`);
