function incompleteHistoryPageError(message) {
  const error = new Error(message);
  error.code = "TOKEN_HISTORY_PAGE_INCOMPLETE";
  return error;
}

export async function readCompleteTokenHistoryPages(
  readPage,
  {
    identityOf,
    pageSize = 500,
    maxPages = 1_000,
  } = {},
) {
  if (typeof readPage !== "function" || typeof identityOf !== "function") {
    throw new TypeError("Token history reader and item identity are required.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new RangeError("Token history page size must be between 1 and 500.");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new RangeError("Token history page limit must be a positive integer.");
  }

  let cursor = "";
  let snapshotId = "";
  let indexedThroughBlock = null;
  let totalCount = null;
  let lastPage = null;
  const seenCursors = new Set();
  const seenIdentities = new Set();
  const items = [];

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await readPage({ cursor, snapshotId, limit: pageSize });
    const pageItems = Array.isArray(page?.items) ? page.items : null;
    const currentSnapshotId = String(page?.snapshotId ?? "").trim();
    const currentHeight = page?.indexedThroughBlock;
    const currentTotal = page?.totalCount;
    const start = page?.start;
    const end = page?.end;
    const nextCursor = String(page?.nextCursor ?? "").trim();
    const expectedEnd =
      Number.isSafeInteger(start) && pageItems
        ? start + pageItems.length
        : null;
    const hasMore =
      Number.isSafeInteger(end) &&
      Number.isSafeInteger(currentTotal) &&
      end < currentTotal;

    if (
      !pageItems ||
      pageItems.length > pageSize ||
      !currentSnapshotId ||
      !Number.isSafeInteger(currentHeight) ||
      currentHeight < 0 ||
      !Number.isSafeInteger(currentTotal) ||
      currentTotal < 0 ||
      !Number.isSafeInteger(start) ||
      start !== items.length ||
      !Number.isSafeInteger(end) ||
      end !== expectedEnd ||
      end > currentTotal ||
      Boolean(nextCursor) !== hasMore ||
      (snapshotId && currentSnapshotId !== snapshotId) ||
      (indexedThroughBlock !== null &&
        currentHeight !== indexedThroughBlock) ||
      (totalCount !== null && currentTotal !== totalCount)
    ) {
      throw incompleteHistoryPageError(
        "Token history changed snapshot, count, or cursor coverage.",
      );
    }

    for (const item of pageItems) {
      const identity = String(identityOf(item) ?? "").trim().toLowerCase();
      if (!identity || seenIdentities.has(identity)) {
        throw incompleteHistoryPageError(
          "Token history contains a missing or duplicate item identity.",
        );
      }
      seenIdentities.add(identity);
    }

    snapshotId ||= currentSnapshotId;
    indexedThroughBlock ??= currentHeight;
    totalCount ??= currentTotal;
    items.push(...pageItems);
    lastPage = page;
    if (!hasMore) {
      if (items.length !== totalCount) {
        throw incompleteHistoryPageError(
          "Token history ended before its declared total was emitted.",
        );
      }
      return {
        ...lastPage,
        complete: true,
        cursor: "",
        end: items.length,
        indexedThroughBlock,
        items,
        nextCursor: "",
        page: 0,
        pageCount: pageNumber + 1,
        pageSize,
        snapshotId,
        start: 0,
        totalCount: items.length,
      };
    }
    if (seenCursors.has(nextCursor)) {
      throw incompleteHistoryPageError("Token history cursor repeated.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw incompleteHistoryPageError(
    "Token history exceeded the page completeness bound of " +
      String(maxPages) +
      ".",
  );
}
