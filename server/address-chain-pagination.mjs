import { createHash } from "node:crypto";

const TXID_PATTERN = /^[0-9a-f]{64}$/u;

function normalizedTxid(value) {
  const txid = String(value ?? "").trim().toLowerCase();
  return TXID_PATTERN.test(txid) ? txid : "";
}

function compareNormalizedHex(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedPageSize(value) {
  const pageSize = Number(value ?? 25);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("Address chain page size must be an integer from 1 through 100.");
  }
  return pageSize;
}

export function normalizeElectrumAddressHistory(history) {
  if (!Array.isArray(history)) {
    throw new Error("Electrum returned an invalid address history response.");
  }

  const seen = new Set();
  return history.map((entry, index) => {
    const txid = normalizedTxid(entry?.tx_hash);
    const height = Number(entry?.height);
    if (!txid || !Number.isSafeInteger(height)) {
      throw new Error(`Electrum address history entry ${index} is malformed.`);
    }
    if (seen.has(txid)) {
      throw new Error(`Electrum address history repeats transaction ${txid}.`);
    }
    seen.add(txid);
    return { height, txid };
  });
}

export function electrumAddressHistoryCoverage(history) {
  const entries = normalizeElectrumAddressHistory(history);
  const confirmedTxids = entries
    .filter((entry) => entry.height > 0)
    .map((entry) => entry.txid)
    .sort();
  const pendingTxids = entries
    .filter((entry) => entry.height <= 0)
    .map((entry) => entry.txid)
    .sort();
  const snapshotPreimage = entries
    .slice()
    .sort((left, right) => compareNormalizedHex(left.txid, right.txid))
    .map((entry) => `${entry.txid}:${entry.height}`)
    .join("\n");

  return {
    confirmedTxids,
    entries,
    pendingTxids,
    snapshotSha256: createHash("sha256")
      .update(snapshotPreimage, "utf8")
      .digest("hex"),
  };
}

function chainCursor(path) {
  const match = /^txs\/chain(?:\/([0-9a-f]{64}))?$/iu.exec(String(path ?? ""));
  return match ? String(match[1] ?? "").toLowerCase() : null;
}

function canonicalBlockDescriptor(value, expectedHeight) {
  const blockHash = normalizedTxid(value?.blockHash);
  const txids = Array.isArray(value?.txids)
    ? value.txids.map(normalizedTxid)
    : [];
  if (
    !blockHash ||
    txids.length === 0 ||
    txids.some((txid) => !txid) ||
    new Set(txids).size !== txids.length
  ) {
    throw new Error(
      `First-party block transaction order is incomplete at height ${expectedHeight}.`,
    );
  }
  return { blockHash, txids };
}

async function orderedHistoryGroup(entries, height, fetchCanonicalBlock) {
  const block = canonicalBlockDescriptor(
    await fetchCanonicalBlock(height),
    height,
  );
  const indexByTxid = new Map(
    block.txids.map((txid, blockIndex) => [txid, blockIndex]),
  );
  const ordered = entries.map((entry) => {
    const blockIndex = indexByTxid.get(entry.txid);
    if (!Number.isSafeInteger(blockIndex)) {
      throw new Error(
        `Electrum transaction ${entry.txid} is absent from the canonical block at height ${height}.`,
      );
    }
    return {
      blockHash: block.blockHash,
      blockHeight: height,
      blockIndex,
      txid: entry.txid,
    };
  });
  return ordered.sort(
    (left, right) =>
      right.blockIndex - left.blockIndex ||
      compareNormalizedHex(left.txid, right.txid),
  );
}

export async function electrumConfirmedAddressPage({
  cursor = "",
  fetchCanonicalBlock,
  history,
  hydratePage,
  pageSize = 25,
}) {
  if (typeof fetchCanonicalBlock !== "function" || typeof hydratePage !== "function") {
    throw new TypeError("Address chain pagination requires block and transaction readers.");
  }

  const limit = boundedPageSize(pageSize);
  const normalizedCursor = cursor ? normalizedTxid(cursor) : "";
  if (cursor && !normalizedCursor) {
    throw new Error("Address chain cursor is invalid.");
  }

  if (!Array.isArray(history)) {
    throw new Error("Electrum returned an invalid address history response.");
  }
  const entries = normalizeElectrumAddressHistory(history).filter(
    (entry) => entry.height > 0,
  );
  const cursorEntry = normalizedCursor
    ? entries.find((entry) => entry.txid === normalizedCursor)
    : null;
  if (normalizedCursor && !cursorEntry) {
    throw new Error("Address chain cursor is absent from Electrum history.");
  }

  const entriesByHeight = new Map();
  for (const entry of entries) {
    const group = entriesByHeight.get(entry.height) ?? [];
    group.push(entry);
    entriesByHeight.set(entry.height, group);
  }

  const selected = [];
  const heights = [...entriesByHeight.keys()].sort((left, right) => right - left);
  for (const height of heights) {
    if (cursorEntry && height > cursorEntry.height) {
      continue;
    }

    let ordered = await orderedHistoryGroup(
      entriesByHeight.get(height),
      height,
      fetchCanonicalBlock,
    );
    if (cursorEntry && height === cursorEntry.height) {
      const cursorIndex = ordered.findIndex(
        (entry) => entry.txid === normalizedCursor,
      );
      if (cursorIndex === -1) {
        throw new Error("Address chain cursor has no canonical block position.");
      }
      ordered = ordered.slice(cursorIndex + 1);
    }

    selected.push(...ordered.slice(0, limit - selected.length));
    if (selected.length === limit) {
      break;
    }
  }

  if (selected.length === 0) {
    return [];
  }

  const hydrated = await hydratePage(selected.map((entry) => ({ ...entry })));
  if (!Array.isArray(hydrated) || hydrated.length !== selected.length) {
    throw new Error("First-party address chain page hydration was partial.");
  }

  return hydrated.map((transaction, index) => {
    const expected = selected[index];
    const txid = normalizedTxid(transaction?.txid);
    const blockHash = normalizedTxid(transaction?.status?.block_hash);
    const blockHeight = transaction?.status?.block_height;
    if (
      !transaction ||
      typeof transaction !== "object" ||
      txid !== expected.txid ||
      transaction.status?.confirmed !== true ||
      blockHash !== expected.blockHash ||
      (blockHeight !== undefined && Number(blockHeight) !== expected.blockHeight) ||
      !Array.isArray(transaction.vin) ||
      !Array.isArray(transaction.vout)
    ) {
      throw new Error(
        `First-party address chain hydration did not prove ${expected.txid}.`,
      );
    }

    return {
      ...transaction,
      _powBlockIndex: expected.blockIndex,
      status: {
        ...transaction.status,
        block_hash: expected.blockHash,
        block_height: expected.blockHeight,
        block_index: expected.blockIndex,
        confirmed: true,
      },
    };
  });
}

export async function firstPartyAddressTransactionsPage({
  fallbackAllowed = false,
  fetchCanonicalBlock,
  fetchElectrumHistory,
  fetchLocalPage,
  forceCanonicalFallback = false,
  hydratePage,
  pageSize = 25,
  path,
}) {
  if (typeof fetchLocalPage !== "function") {
    throw new TypeError("A local address page reader is required.");
  }

  const cursor = chainCursor(path);
  let localError = new Error(
    "The authenticated registry audit requires canonical Electrum and Bitcoin Core readers.",
  );
  if (forceCanonicalFallback !== true) {
    try {
      const transactions = await fetchLocalPage(path);
      if (!Array.isArray(transactions)) {
        throw new Error("The local address page reader returned an invalid response.");
      }
      return transactions;
    } catch (error) {
      localError = error;
    }
  }

  if (cursor === null || fallbackAllowed !== true) {
    throw localError;
  }

  try {
    return await electrumConfirmedAddressPage({
      cursor,
      fetchCanonicalBlock,
      history: await fetchElectrumHistory(),
      hydratePage,
      pageSize,
    });
  } catch (fallbackError) {
    const error = new Error(
      "The first-party address chain page is unavailable from canonical readers.",
      { cause: new AggregateError([localError, fallbackError]) },
    );
    error.statusCode = 503;
    throw error;
  }
}
