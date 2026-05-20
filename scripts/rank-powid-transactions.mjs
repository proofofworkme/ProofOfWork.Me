#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const NETWORK = process.env.NETWORK || "livenet";
const POW_API_BASE = (process.env.POW_API_BASE || "https://computer.proofofwork.me").replace(/\/+$/u, "");
const MEMPOOL_BASE = (process.env.MEMPOOL_BASE || "https://mempool.space").replace(/\/+$/u, "");
const INCLUDE_PENDING = process.env.INCLUDE_PENDING === "1";
const ADDRESS_ROLE = process.env.ADDRESS_ROLE === "owner" ? "owner" : "receive";
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.CONCURRENCY || "6", 10) || 6);
const OUTPUT_PREFIX = process.env.OUTPUT_PREFIX || "/tmp/proofofwork-powid-transaction-ranking";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url);
  if ((response.status === 429 || response.status >= 500) && attempt <= 5) {
    await sleep(500 * attempt);
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

function csvValue(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  return [
    columns.map((column) => csvValue(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(column.value(row))).join(",")),
  ].join("\n");
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function addressForRecord(record) {
  return ADDRESS_ROLE === "owner" ? record.ownerAddress : record.receiveAddress;
}

function addressStatsFromResponse(address, response) {
  const chainStats = response?.chain_stats && typeof response.chain_stats === "object" ? response.chain_stats : {};
  const mempoolStats = response?.mempool_stats && typeof response.mempool_stats === "object" ? response.mempool_stats : {};
  const chainTxCount = Number.isSafeInteger(chainStats.tx_count) ? chainStats.tx_count : 0;
  const mempoolTxCount = Number.isSafeInteger(mempoolStats.tx_count) ? mempoolStats.tx_count : 0;

  return {
    address,
    chainTxCount,
    mempoolTxCount,
    totalTxCount: chainTxCount + mempoolTxCount,
  };
}

function compareRanked(left, right) {
  return (
    right.chainTxCount - left.chainTxCount ||
    right.mempoolTxCount - left.mempoolTxCount ||
    left.id.localeCompare(right.id)
  );
}

function compareGroups(left, right) {
  return (
    right.chainTxCount - left.chainTxCount ||
    right.mempoolTxCount - left.mempoolTxCount ||
    left.address.localeCompare(right.address)
  );
}

function buildRows(records, statsByAddress) {
  return records
    .map((record) => {
      const address = addressForRecord(record);
      const stats = statsByAddress.get(address) || {
        address,
        chainTxCount: 0,
        mempoolTxCount: 0,
        totalTxCount: 0,
      };

      return {
        address,
        addressRole: ADDRESS_ROLE,
        chainTxCount: stats.chainTxCount,
        confirmed: Boolean(record.confirmed),
        createdAt: record.createdAt || "",
        id: `${record.id}@proofofwork.me`,
        idName: record.id,
        mempoolTxCount: stats.mempoolTxCount,
        network: record.network || NETWORK,
        ownerAddress: record.ownerAddress || "",
        receiveAddress: record.receiveAddress || "",
        registryTxid: record.txid || "",
        totalTxCount: stats.totalTxCount,
      };
    })
    .sort(compareRanked)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function buildGroups(rows) {
  const groupsByAddress = new Map();

  for (const row of rows) {
    const current = groupsByAddress.get(row.address) || {
      address: row.address,
      addressRole: row.addressRole,
      chainTxCount: row.chainTxCount,
      confirmedIds: [],
      ids: [],
      mempoolTxCount: row.mempoolTxCount,
      pendingIds: [],
      totalTxCount: row.totalTxCount,
    };

    current.ids.push(row.id);
    if (row.confirmed) {
      current.confirmedIds.push(row.id);
    } else {
      current.pendingIds.push(row.id);
    }
    groupsByAddress.set(row.address, current);
  }

  return [...groupsByAddress.values()]
    .map((group) => ({
      ...group,
      confirmedIdCount: group.confirmedIds.length,
      idCount: group.ids.length,
      ids: group.ids.sort(),
      pendingIdCount: group.pendingIds.length,
    }))
    .sort(compareGroups)
    .map((group, index) => ({ rank: index + 1, ...group }));
}

async function main() {
  const registryUrl = `${POW_API_BASE}/api/v1/registry?network=${encodeURIComponent(NETWORK)}`;
  const registry = await fetchJson(registryUrl);
  const allRecords = Array.isArray(registry.records) ? registry.records : [];
  const records = allRecords.filter((record) => INCLUDE_PENDING || record.confirmed);
  const addresses = [...new Set(records.map(addressForRecord).filter(Boolean))];

  const stats = await mapLimit(addresses, CONCURRENCY, async (address) => {
    const response = await fetchJson(`${MEMPOOL_BASE}/api/address/${address}`);
    return addressStatsFromResponse(address, response);
  });
  const statsByAddress = new Map(stats.map((item) => [item.address, item]));
  const rows = buildRows(records, statsByAddress);
  const groups = buildGroups(rows);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = `${OUTPUT_PREFIX}-${timestamp}.json`;
  const csvPath = `${OUTPUT_PREFIX}-${timestamp}.csv`;
  const groupCsvPath = `${OUTPUT_PREFIX}-by-address-${timestamp}.csv`;

  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        addressRole: ADDRESS_ROLE,
        generatedAt: new Date().toISOString(),
        includePending: INCLUDE_PENDING,
        mempoolBase: MEMPOOL_BASE,
        network: NETWORK,
        powApiBase: POW_API_BASE,
        registryIndexedAt: registry.indexedAt || "",
        registryStats: registry.stats || {},
        rows,
        source: registryUrl,
        uniqueAddresses: addresses.length,
        walletGroups: groups,
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    csvPath,
    `${toCsv(rows, [
      { header: "rank", value: (row) => row.rank },
      { header: "pow_id", value: (row) => row.id },
      { header: "chain_tx_count", value: (row) => row.chainTxCount },
      { header: "mempool_tx_count", value: (row) => row.mempoolTxCount },
      { header: "total_tx_count", value: (row) => row.totalTxCount },
      { header: "address_role", value: (row) => row.addressRole },
      { header: "address", value: (row) => row.address },
      { header: "owner_address", value: (row) => row.ownerAddress },
      { header: "receive_address", value: (row) => row.receiveAddress },
      { header: "confirmed", value: (row) => row.confirmed },
      { header: "created_at", value: (row) => row.createdAt },
      { header: "registry_txid", value: (row) => row.registryTxid },
    ])}\n`,
  );

  await writeFile(
    groupCsvPath,
    `${toCsv(groups, [
      { header: "rank", value: (group) => group.rank },
      { header: "address", value: (group) => group.address },
      { header: "chain_tx_count", value: (group) => group.chainTxCount },
      { header: "mempool_tx_count", value: (group) => group.mempoolTxCount },
      { header: "total_tx_count", value: (group) => group.totalTxCount },
      { header: "pow_id_count", value: (group) => group.idCount },
      { header: "confirmed_pow_id_count", value: (group) => group.confirmedIdCount },
      { header: "pending_pow_id_count", value: (group) => group.pendingIdCount },
      { header: "pow_ids", value: (group) => group.ids.join(" ") },
    ])}\n`,
  );

  console.log("ProofOfWork ID transaction ranking");
  console.log(`Registry indexed: ${registry.indexedAt || "unknown"}`);
  console.log(`Records ranked: ${rows.length}`);
  console.log(`Unique ${ADDRESS_ROLE} addresses checked: ${addresses.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Address CSV: ${groupCsvPath}`);
  console.log("");
  console.log("Top IDs by confirmed address transaction count");
  for (const row of rows.slice(0, 20)) {
    console.log(
      `${String(row.rank).padStart(2, " ")}. ${row.id.padEnd(30, " ")} ${String(row.chainTxCount).padStart(6, " ")} tx  ${row.address}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
