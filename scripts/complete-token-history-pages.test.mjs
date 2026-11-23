import assert from "node:assert/strict";
import { test } from "node:test";
import { readCompleteTokenHistoryPages } from "./complete-token-history-pages.mjs";
import { checkWalletParticipantTransfer } from "./participant-transfer-regression.mjs";

const txid = (index) => index.toString(16).padStart(64, "0");

function page(items, { start, totalCount, snapshotId = "snapshot", height = 100, nextCursor = "" }) {
  return {
    end: start + items.length,
    indexedThroughBlock: height,
    items,
    nextCursor,
    snapshotId,
    start,
    totalCount,
  };
}

test("complete token history follows opaque cursors on one snapshot", async () => {
  const listings = Array.from({ length: 1_201 }, (_value, index) => ({
    listingId: txid(index + 1),
  }));
  const calls = [];
  const result = await readCompleteTokenHistoryPages(
    async ({ cursor, snapshotId, limit }) => {
      calls.push({ cursor, snapshotId, limit });
      const start = cursor ? Number(cursor.slice("opaque-".length)) : 0;
      const end = Math.min(listings.length, start + limit);
      return page(listings.slice(start, end), {
        start,
        totalCount: listings.length,
        nextCursor: end < listings.length ? "opaque-" + String(end) : "",
      });
    },
    { identityOf: (item) => item.listingId },
  );

  assert.deepEqual(calls.map(({ cursor }) => cursor), ["", "opaque-500", "opaque-1000"]);
  assert.equal(calls[1].snapshotId, "snapshot");
  assert.equal(result.complete, true);
  assert.equal(result.items.length, 1_201);
  assert.equal(result.pageCount, 3);
});

test("an exact empty token-history page is complete", async () => {
  const result = await readCompleteTokenHistoryPages(
    async () => page([], { start: 0, totalCount: 0 }),
    { identityOf: (item) => item.listingId },
  );
  assert.equal(result.complete, true);
  assert.equal(result.items.length, 0);
  assert.equal(result.totalCount, 0);
});

test("token history rejects snapshot changes, missing rows and duplicate identities", async () => {
  const cases = [
    async ({ cursor }) =>
      page([{ listingId: txid(cursor ? 2 : 1) }], {
        start: cursor ? 1 : 0,
        totalCount: 2,
        nextCursor: cursor ? "" : "opaque-1",
        snapshotId: cursor ? "changed" : "snapshot",
      }),
    async ({ cursor }) =>
      page([{ listingId: txid(cursor ? 2 : 1) }], {
        start: cursor ? 1 : 0,
        totalCount: cursor ? 3 : 2,
        nextCursor: cursor ? "opaque-2" : "opaque-1",
      }),
    async ({ cursor }) =>
      page([{ listingId: txid(1) }], {
        start: cursor ? 1 : 0,
        totalCount: 2,
        nextCursor: cursor ? "" : "opaque-1",
      }),
    async ({ cursor }) =>
      page([{ listingId: txid(cursor ? 2 : 1) }], {
        start: cursor ? 1 : 0,
        totalCount: 2,
        nextCursor: cursor ? "" : "opaque-1",
        height: cursor ? 101 : 100,
      }),
  ];

  for (const readPage of cases) {
    await assert.rejects(
      readCompleteTokenHistoryPages(readPage, {
        identityOf: (item) => item.listingId,
        pageSize: 1,
      }),
      (error) => error?.code === "TOKEN_HISTORY_PAGE_INCOMPLETE",
    );
  }
});

test("token history rejects cursor loops and page-bound exhaustion", async () => {
  await assert.rejects(
    readCompleteTokenHistoryPages(
      async ({ cursor }) =>
        page([{ listingId: txid(cursor ? 2 : 1) }], {
          start: cursor ? 1 : 0,
          totalCount: 3,
          nextCursor: "repeated",
        }),
      { identityOf: (item) => item.listingId, pageSize: 1 },
    ),
    (error) => error?.code === "TOKEN_HISTORY_PAGE_INCOMPLETE",
  );

  let calls = 0;
  await assert.rejects(
    readCompleteTokenHistoryPages(
      async () => {
        calls += 1;
        return page([{ listingId: txid(calls) }], {
          start: calls - 1,
          totalCount: 3,
          nextCursor: "opaque-" + String(calls),
        });
      },
      { identityOf: (item) => item.listingId, pageSize: 1, maxPages: 2 },
    ),
    (error) => error?.code === "TOKEN_HISTORY_PAGE_INCOMPLETE",
  );
  assert.equal(calls, 2);
});


// Synthetic wallet and history responses for the established 300k recipient and
// 20k sender regressions. The 500 rows model a bounded summary, not live history.
const workId = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const transfer300k = {
  amount: "300000", blockHeight: 956369, tokenId: workId,
  txid: "6ed13a1783d612dc1c1f692d2bd6e60c55f3bf88ead9352112a78931ea18852f",
  senderAddress: "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
  recipientAddress: "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW",
};
const transfer20k = {
  amount: "20000", blockHeight: 955792, tokenId: workId,
  txid: "c90f95cdd45892f76af89686dea7c1c35ec070148e5a74c947f174e244ef44db",
  senderAddress: transfer300k.recipientAddress,
  recipientAddress: "14hKW6Z3WKrJZayZhCvLJCocMaaAtTHd9L",
};

function participantFixture(expected = transfer300k, address = expected.recipientAddress) {
  const row = {
    ...expected, amountSubatoms: String(BigInt(expected.amount) * 10n ** 16n),
    amountStorageModel: "work-subatoms-v2", decimals: 16, unitScale: "10000000000000000",
    confirmed: true, createdAt: "2026-06-30T12:00:00Z", ticker: "WORK",
  };
  const checkpoint = { indexedThroughBlock: 977230, indexedThroughBlockHash: txid(977230), network: "livenet" };
  const history = {
    ...checkpoint, kind: "transfers", start: 0, end: 1, totalCount: 1, hasMore: false,
    nextCursor: "", items: [row], canonicalInvalidTxids: [], snapshotId: "history-fixture",
  };
  const wallet = {
    ...checkpoint, authoritativeWallet: true, walletScoped: true, summaryOnly: true,
    tokenScope: workId, transfers: [row], invalidEvents: [], snapshotId: "wallet-fixture",
  };
  const calls = [];
  async function read(path, params) {
    calls.push(path);
    const base = { asset: workId, network: "livenet", fresh: 1 };
    if (path === "/api/v1/token-history") {
      assert.deepEqual(params, { ...base, kind: "transfers", q: address, txid: expected.txid, limit: 2 });
      return history;
    }
    assert.equal(path, "/api/v1/token");
    assert.deepEqual(params, { ...base, address, wallet: 1 });
    return wallet;
  }
  return { row, history, wallet, calls, run: () => checkWalletParticipantTransfer(read, "livenet", address, expected) };
}

test("an exact historical WORK transfer remains discoverable in either participant scope", async () => {
  for (const expected of [transfer300k, transfer20k]) {
    for (const address of [expected.senderAddress, expected.recipientAddress]) {
      const f = participantFixture(expected, address);
      await f.run();
      assert.deepEqual(f.calls, ["/api/v1/token-history", "/api/v1/token"]);
      for (const length of [0, 16, 500]) {
        f.wallet.transfers = Array.from({ length }, (_, index) => ({
          ...f.row, txid: txid(index + 10), blockHeight: 976634, createdAt: "2026-11-20T12:00:00Z",
        }));
        // Other selected raw events (for example, inactive listings) may
        // disappear when the reader projects this mixed wallet window.
        f.wallet.listings = [];
        f.wallet.sales = [{ txid: txid(3), confirmed: true, buyerAddress: address }];
        await f.run();
      }
    }
  }
});

test("missing, duplicate, incomplete or corrupt exact WORK history fails even with the target in the wallet", async () => {
  for (const overrides of [
    { items: [], totalCount: 0, end: 0 }, { totalCount: 2 }, { hasMore: true },
    { nextCursor: "more" }, { start: 1 }, { end: 2 }, { kind: "sales" },
    { canonicalInvalidTxids: [transfer300k.txid] }, { network: "testnet" },
  ]) {
    const f = participantFixture();
    Object.assign(f.history, overrides);
    await assert.rejects(f.run(), assert.AssertionError);
  }
  const duplicate = participantFixture();
  duplicate.history.items.push(duplicate.row);
  await assert.rejects(duplicate.run(), /exactly one/);
  for (const overrides of [
    { txid: txid(12) }, { confirmed: false }, { valid: false }, { tokenId: undefined },
    { tokenId: txid(9) }, { ticker: "POWB" }, { blockHeight: 956370 },
    { senderAddress: transfer300k.recipientAddress }, { recipientAddress: transfer300k.recipientAddress.toLowerCase() },
    { amount: "300000.0000000000000001" }, { amountSubatoms: "300001" },
    { txId: txid(12) }, { network: "testnet" },
  ]) {
    for (const surface of ["history", "wallet"]) {
      const f = participantFixture();
      const rows = surface === "wallet" ? f.wallet.transfers : f.history.items;
      // For the wallet, a *different* identity is a legitimate omission.
      if (surface === "wallet" && overrides.txid) continue;
      rows[0] = { ...f.row, ...overrides };
      await assert.rejects(f.run(), assert.AssertionError);
    }
  }
});

test("scoped wallet rejects duplicate or invalid aliases and missing authority", async () => {
  const duplicate = participantFixture();
  duplicate.wallet.transfers.push(duplicate.row);
  await assert.rejects(duplicate.run(), /duplicates/);
  const aliasOnly = participantFixture();
  aliasOnly.wallet.transfers = [{ ...aliasOnly.row, txid: undefined, txId: transfer300k.txid }];
  await assert.rejects(aliasOnly.run(), /identity/);
  for (const overrides of [
    { invalidEvents: [{ txId: transfer300k.txid }] },
    { invalidEvents: [{ txid: transfer300k.txid }] }, { summaryOnly: false },
    { authoritativeWallet: false }, { walletScoped: false }, { transfers: undefined },
    { tokenScope: txid(1) }, { network: "testnet" },
  ]) {
    const f = participantFixture();
    Object.assign(f.wallet, overrides);
    await assert.rejects(f.run(), assert.AssertionError);
  }
});

test("an omitted direct confirmed transfer fails within a proven wallet window on the same checkpoint", async () => {
  const f = participantFixture();
  const older = { ...f.row, txid: txid(1), createdAt: "2026-06-01T12:00:00Z", blockHeight: 955000 };
  f.wallet.transfers = [older];
  await assert.rejects(f.run(), /older confirmed transfer/);
  for (const override of [
    { confirmed: false }, { derived: true }, { transferVersion: "batch1" },
    { createdAt: f.row.createdAt }, { blockHeight: f.row.blockHeight }, { tokenId: txid(4) },
  ]) {
    f.wallet.transfers = [{ ...older, ...override }];
    await f.run();
  }
  f.wallet.transfers = [older];
  f.wallet.indexedThroughBlockHash = txid(2);
  await f.run();
});
