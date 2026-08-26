#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  electrumAddressHistoryCoverage,
  electrumConfirmedAddressPage,
  firstPartyAddressTransactionsPage,
} from "../server/address-chain-pagination.mjs";

const txid = (value) => Number(value).toString(16).padStart(64, "0");
const pendingTxid = txid(900);
const newestHeightTxids = [txid(11), txid(12), txid(13)];
const olderHeightTxids = Array.from({ length: 24 }, (_value, index) =>
  txid(100 + index),
);
const history = [
  ...olderHeightTxids.map((hash) => ({ height: 100, tx_hash: hash })),
  { height: 0, tx_hash: pendingTxid },
  ...newestHeightTxids.map((hash) => ({ height: 101, tx_hash: hash })),
];
const blocks = new Map([
  [
    101,
    {
      blockHash: "a".repeat(64),
      txids: [txid(1), newestHeightTxids[0], txid(2), newestHeightTxids[1], newestHeightTxids[2]],
    },
  ],
  [
    100,
    {
      blockHash: "b".repeat(64),
      txids: [txid(3), ...olderHeightTxids, txid(4)],
    },
  ],
]);
const hydrate = async (entries) =>
  entries.map((entry) => ({
    status: {
      block_hash: entry.blockHash,
      confirmed: true,
    },
    txid: entry.txid,
    vin: [{ prevout: { scriptpubkey: "00", value: 1 } }],
    vout: [],
  }));

let localCalls = 0;
let historyCalls = 0;
const hydratedPages = [];
const firstPage = await firstPartyAddressTransactionsPage({
  fallbackAllowed: true,
  fetchCanonicalBlock: async (height) => blocks.get(height),
  fetchElectrumHistory: async () => {
    historyCalls += 1;
    return history;
  },
  fetchLocalPage: async () => {
    localCalls += 1;
    throw new Error("local /txs/chain is unavailable");
  },
  hydratePage: async (entries) => {
    hydratedPages.push(entries);
    return hydrate(entries);
  },
  pageSize: 25,
  path: "txs/chain",
});

assert.equal(localCalls, 1);
assert.equal(historyCalls, 1);
assert.equal(firstPage.length, 25);
assert.equal(hydratedPages.length, 1);
assert.equal(hydratedPages[0].length, 25, "the fallback hydrates only one page");
assert.deepEqual(
  firstPage.slice(0, 3).map((transaction) => transaction.txid),
  newestHeightTxids.slice().reverse(),
  "same-block rows use descending canonical block position",
);
assert.ok(firstPage.every((transaction) => transaction.status.confirmed));
assert.ok(firstPage.every((transaction) => transaction.status.block_index >= 0));
assert.ok(!firstPage.some((transaction) => transaction.txid === pendingTxid));

const cursor = firstPage.at(-1).txid;
const secondPage = await firstPartyAddressTransactionsPage({
  fallbackAllowed: true,
  fetchCanonicalBlock: async (height) => blocks.get(height),
  fetchElectrumHistory: async () => history,
  fetchLocalPage: async () => {
    throw new Error("local cursor route is unavailable");
  },
  hydratePage: hydrate,
  pageSize: 25,
  path: `txs/chain/${cursor}`,
});
assert.equal(secondPage.length, 2);
assert.equal(
  new Set([...firstPage, ...secondPage].map((transaction) => transaction.txid)).size,
  27,
);

let fallbackCalled = false;
const localResult = [{ txid: txid(700) }];
assert.equal(
  await firstPartyAddressTransactionsPage({
    fetchCanonicalBlock: async () => {
      fallbackCalled = true;
    },
    fetchElectrumHistory: async () => {
      fallbackCalled = true;
      return [];
    },
    fetchLocalPage: async () => localResult,
    hydratePage: async () => {
      fallbackCalled = true;
      return [];
    },
    path: "txs/chain",
  }),
  localResult,
);
assert.equal(fallbackCalled, false, "healthy local pages do not fan out");

let forcedLocalCalls = 0;
const forcedPage = await firstPartyAddressTransactionsPage({
  fallbackAllowed: true,
  fetchCanonicalBlock: async (height) => blocks.get(height),
  fetchElectrumHistory: async () => history,
  fetchLocalPage: async () => {
    forcedLocalCalls += 1;
    return localResult;
  },
  forceCanonicalFallback: true,
  hydratePage: hydrate,
  path: "txs/chain",
});
assert.equal(forcedLocalCalls, 0, "authenticated audit reads never trust local pages");
assert.equal(forcedPage.length, 25);

await assert.rejects(
  firstPartyAddressTransactionsPage({
    fetchCanonicalBlock: async (height) => blocks.get(height),
    fetchElectrumHistory: async () => history,
    fetchLocalPage: async () => {
      throw new Error("local recent route is unavailable");
    },
    hydratePage: hydrate,
    path: "txs",
  }),
  /local recent route is unavailable/u,
  "non-chain routes never invoke the history fallback",
);

let disallowedHistoryCalls = 0;
await assert.rejects(
  firstPartyAddressTransactionsPage({
    fallbackAllowed: false,
    fetchCanonicalBlock: async () => {
      disallowedHistoryCalls += 1;
    },
    fetchElectrumHistory: async () => {
      disallowedHistoryCalls += 1;
      return history;
    },
    fetchLocalPage: async () => {
      throw new Error("unscoped address chain route is unavailable");
    },
    hydratePage: async () => {
      disallowedHistoryCalls += 1;
      return [];
    },
    path: "txs/chain",
  }),
  /unscoped address chain route is unavailable/u,
);
assert.equal(
  disallowedHistoryCalls,
  0,
  "non-registry addresses cannot trigger Electrum history or Core hydration",
);

let oversizedHistoryCalls = 0;
await assert.rejects(
  firstPartyAddressTransactionsPage({
    fallbackAllowed: false,
    fetchCanonicalBlock: async () => {
      oversizedHistoryCalls += 1;
    },
    fetchElectrumHistory: async () => {
      oversizedHistoryCalls += 1;
      return Array.from({ length: 100_000 }, (_value, index) => ({
        height: index + 1,
        tx_hash: txid(index + 10_000),
      }));
    },
    fetchLocalPage: async () => {
      throw new Error("oversized unscoped history is unavailable");
    },
    hydratePage: async () => {
      oversizedHistoryCalls += 1;
      return [];
    },
    path: "txs/chain",
  }),
  /oversized unscoped history is unavailable/u,
);
assert.equal(oversizedHistoryCalls, 0, "unscoped callers cannot trigger large history work");

let oversizedCanonicalBlockCalls = 0;
let oversizedCanonicalHydrationCalls = 0;
const lifetimeHistoryTxids = Array.from(
  { length: 6_001 },
  (_value, index) => txid(index + 30_000),
);
const lifetimeHistory = lifetimeHistoryTxids.map((hash) => ({
  height: 102,
  tx_hash: hash,
}));
const lifetimePage = await firstPartyAddressTransactionsPage({
  fallbackAllowed: true,
  fetchCanonicalBlock: async () => {
    oversizedCanonicalBlockCalls += 1;
    return {
      blockHash: "c".repeat(64),
      txids: lifetimeHistoryTxids,
    };
  },
  fetchElectrumHistory: async () => lifetimeHistory,
  fetchLocalPage: async () => {
    throw new Error("canonical fallback required");
  },
  hydratePage: async (entries) => {
    oversizedCanonicalHydrationCalls += entries.length;
    return hydrate(entries);
  },
  pageSize: 25,
  path: "txs/chain",
});
assert.equal(lifetimePage.length, 25);
assert.equal(oversizedCanonicalBlockCalls, 1);
assert.equal(
  oversizedCanonicalHydrationCalls,
  25,
  "A history beyond the retired lifetime cap still hydrates one bounded page.",
);

await assert.rejects(
  electrumConfirmedAddressPage({
    fetchCanonicalBlock: async (height) => blocks.get(height),
    history,
    hydratePage: async (entries) => hydrate(entries.slice(1)),
  }),
  /hydration was partial/u,
);

await assert.rejects(
  electrumConfirmedAddressPage({
    fetchCanonicalBlock: async () => ({
      blockHash: "c".repeat(64),
      txids: [txid(999)],
    }),
    history,
    hydratePage: hydrate,
  }),
  /absent from the canonical block/u,
);

await assert.rejects(
  electrumConfirmedAddressPage({
    cursor: txid(999),
    fetchCanonicalBlock: async (height) => blocks.get(height),
    history,
    hydratePage: hydrate,
  }),
  /cursor is absent/u,
);

assert.throws(
  () => electrumAddressHistoryCoverage([...history, history[0]]),
  /repeats transaction/u,
);
assert.deepEqual(electrumAddressHistoryCoverage(history).pendingTxids, [pendingTxid]);

const serverSource = readFileSync("server/proof-api.mjs", "utf8");
const moduleSource = readFileSync("server/address-chain-pagination.mjs", "utf8");
assert.match(
  serverSource,
  /fetchAddressTransactionsPage[\s\S]*firstPartyAddressTransactionsPage[\s\S]*fetchExactAddressHistoryFromElectrum/u,
);
assert.match(
  serverSource,
  /fallbackAllowed:[\s\S]*options\.allowCanonicalFallback === true[\s\S]*address === registryAddressForNetwork\(network\)/u,
);
assert.match(
  serverSource,
  /forceCanonicalFallback:[\s\S]*options\.forceCanonicalFallback === true[\s\S]*address === registryAddressForNetwork\(network\)/u,
);
assert.match(moduleSource, /fallbackAllowed = false/u);
assert.match(
  serverSource,
  /fetchCanonicalAddressHistoryBlock[\s\S]*getblockhash[\s\S]*fetchCoreBlockTxidIndex/u,
);
assert.match(
  serverSource,
  /hydrateCanonicalAddressHistoryTransaction[\s\S]*requireCanonicalPrevouts: true/u,
);
assert.doesNotMatch(moduleSource, /mempool\.space|blockchain\.info/u);

console.log("ID first-party address chain route checks passed.");
