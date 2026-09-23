import assert from "node:assert/strict";
import { test } from "node:test";
import { readCompleteEventHistoryPages } from "./event-history-pages.mjs";

const blockHash = "a".repeat(64);
const txid = (eventId) => eventId.toString(16).padStart(64, "0");

function fixturePage(
  items,
  {
    cursor = "",
    totalCount = items.length,
    snapshotId = "snapshot",
    height = 100,
    hash = blockHash,
    start: startOverride,
    hasMore = false,
    nextCursor = "",
  } = {},
) {
  const cursorStart = cursor
    ? Number(cursor.slice("cursor-".length))
    : 0;
  const start = startOverride ?? cursorStart;
  const end = start + items.length;
  return {
    cursor,
    emitted: end,
    end,
    hasMore,
    indexedThroughBlock: height,
    indexedThroughBlockHash: hash,
    items,
    nextCursor,
    snapshotId,
    start,
    totalCount,
  };
}

test("complete event history follows opaque cursors and binds rows to one snapshot", async () => {
  const all = Array.from({ length: 1_201 }, (_value, index) => ({
    eventId: index + 1,
    txid: txid(index + 1),
  }));
  const calls = [];
  const readPage = async (network, params) => {
    assert.equal(network, "livenet");
    calls.push(new URLSearchParams(params));
    const cursor = params.get("cursor") ?? "";
    const start = cursor ? Number(cursor.slice("cursor-".length)) : 0;
    const items = all.slice(start, start + 500);
    const end = start + items.length;
    return fixturePage(items, {
      cursor,
      totalCount: all.length,
      hasMore: end < all.length,
      nextCursor: end < all.length ? `cursor-${end}` : "",
    });
  };

  const result = await readCompleteEventHistoryPages(
    "livenet",
    new URLSearchParams({ address: "bc1qexample", status: "confirmed" }),
    readPage,
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((params) => params.get("cursor") ?? ""),
    ["", "cursor-500", "cursor-1000"],
  );
  assert.equal(calls[1].get("snapshot"), "snapshot");
  assert.equal(result.complete, true);
  assert.equal(result.totalCount, 1_201);
  assert.equal(result.items.length, 1_201);
  assert.equal(result.pageCount, 3);
});

test("an exact empty event-history page is complete and stays distinct from failure", async () => {
  const result = await readCompleteEventHistoryPages(
    "livenet",
    new URLSearchParams({ address: "bc1qexample" }),
    async () => fixturePage([], { totalCount: 0 }),
  );
  assert.equal(result.complete, true);
  assert.equal(result.totalCount, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.hasMore, false);
});

test("event history refuses changed snapshots, counts, duplicates and cursor loops", async () => {
  const cases = [
    async (_network, params) => {
      const cursor = params.get("cursor") ?? "";
      return fixturePage([{ eventId: 1, txid: txid(1) }], {
        cursor,
        totalCount: 2,
        hasMore: true,
        nextCursor: "cursor-1",
        snapshotId: cursor ? "changed" : "snapshot",
      });
    },
    async (_network, params) => {
      const cursor = params.get("cursor") ?? "";
      return fixturePage([{ eventId: cursor ? 2 : 1, txid: txid(cursor ? 2 : 1) }], {
        cursor,
        totalCount: cursor ? 3 : 2,
        hasMore: true,
        nextCursor: "cursor-1",
        snapshotId: "snapshot",
      });
    },
    async (_network, params) => {
      const cursor = params.get("cursor") ?? "";
      return fixturePage([{ eventId: 1, txid: txid(1) }], {
        cursor,
        totalCount: 2,
        hasMore: Boolean(cursor),
        nextCursor: cursor ? "" : "cursor-1",
        snapshotId: "snapshot",
      });
    },
    async (_network, params) => {
      const cursor = params.get("cursor") ?? "";
      return fixturePage([{ eventId: 1, txid: txid(1) }], {
        cursor,
        totalCount: 2,
        hasMore: true,
        nextCursor: "same-cursor",
        snapshotId: "snapshot",
      });
    },
  ];
  for (const readPage of cases) {
    await assert.rejects(
      readCompleteEventHistoryPages(
        "livenet",
        new URLSearchParams(),
        readPage,
        { pageSize: 1 },
      ),
      (error) => error?.statusCode === 503,
    );
  }

  let calls = 0;
  await assert.rejects(
    readCompleteEventHistoryPages(
      "livenet",
      new URLSearchParams(),
      async (_network, params) => {
        calls += 1;
        const cursor = params.get("cursor") ?? "";
        return fixturePage([{ eventId: calls, txid: txid(calls) }], {
          cursor,
          totalCount: 3,
          hasMore: true,
          nextCursor: `cursor-${calls}`,
          snapshotId: "snapshot",
        });
      },
      { pageSize: 1, maxPages: 2 },
    ),
    (error) => error?.statusCode === 503,
  );
  assert.equal(calls, 2);
});
