import assert from "node:assert/strict";
import { test } from "node:test";
import { readCompleteTokenHistoryPages } from "./complete-token-history-pages.mjs";

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
