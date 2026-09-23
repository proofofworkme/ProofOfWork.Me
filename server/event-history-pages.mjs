function eventHistoryPageError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.details = { code: "EVENT_HISTORY_PAGE_INCOMPLETE" };
  return error;
}

export async function readCompleteEventHistoryPages(
  network,
  baseSearchParams,
  readPage,
  { pageSize = 500, maxPages = 1_000 } = {},
) {
  if (typeof readPage !== "function") {
    throw new TypeError("Event history page reader is required.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new RangeError("Event history page size must be between 1 and 500.");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new RangeError("Event history page limit must be a positive integer.");
  }

  const base = new URLSearchParams(baseSearchParams ?? "");
  base.set("limit", String(pageSize));
  let cursor = "";
  let snapshotId = "";
  let indexedThroughBlock = null;
  let indexedThroughBlockHash = "";
  let totalCount = null;
  let lastPage = null;
  const seenCursors = new Set();
  const seenEvents = new Set();
  const items = [];

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const params = new URLSearchParams(base);
    if (cursor) {
      params.set("cursor", cursor);
    }
    if (snapshotId) {
      params.set("snapshot", snapshotId);
    }
    const page = await readPage(network, params);
    const pageItems = Array.isArray(page?.items) ? page.items : null;
    const pageSnapshotId = String(page?.snapshotId ?? "").trim();
    const pageHeight = page?.indexedThroughBlock;
    const pageHash = String(page?.indexedThroughBlockHash ?? "")
      .trim()
      .toLowerCase();
    const pageTotal = page?.totalCount;
    const pageStart = page?.start;
    const pageEnd = page?.end;
    const hasMore = page?.hasMore;
    const nextCursor = String(page?.nextCursor ?? "").trim();
    const expectedEnd =
      Number.isSafeInteger(pageStart) && pageItems
        ? pageStart + pageItems.length
        : null;
    if (
      !pageItems ||
      !pageSnapshotId ||
      !Number.isSafeInteger(pageHeight) ||
      pageHeight < 0 ||
      !/^[0-9a-f]{64}$/u.test(pageHash) ||
      !Number.isSafeInteger(pageTotal) ||
      pageTotal < 0 ||
      !Number.isSafeInteger(pageStart) ||
      pageStart !== items.length ||
      !Number.isSafeInteger(pageEnd) ||
      pageEnd !== expectedEnd ||
      pageEnd > pageTotal ||
      page?.emitted !== pageEnd ||
      String(page?.cursor ?? "") !== cursor ||
      typeof hasMore !== "boolean" ||
      hasMore !== (pageEnd < pageTotal) ||
      (hasMore ? !nextCursor : Boolean(nextCursor)) ||
      (snapshotId && pageSnapshotId !== snapshotId) ||
      (indexedThroughBlock !== null && pageHeight !== indexedThroughBlock) ||
      (indexedThroughBlockHash && pageHash !== indexedThroughBlockHash) ||
      (totalCount !== null && pageTotal !== totalCount)
    ) {
      throw eventHistoryPageError(
        "Event history pages changed snapshot, count, or cursor coverage.",
      );
    }

    for (const item of pageItems) {
      const eventId = item?.eventId;
      const txid = String(item?.txid ?? "").trim().toLowerCase();
      if (
        !Number.isSafeInteger(eventId) ||
        eventId < 1 ||
        !/^[0-9a-f]{64}$/u.test(txid)
      ) {
        throw eventHistoryPageError(
          "Event history page contains a row without canonical identity.",
        );
      }
      const eventKey = `${txid}:${eventId}`;
      if (seenEvents.has(eventKey)) {
        throw eventHistoryPageError(
          "Event history pages contain duplicate canonical events.",
        );
      }
      seenEvents.add(eventKey);
    }

    snapshotId ||= pageSnapshotId;
    indexedThroughBlock ??= pageHeight;
    indexedThroughBlockHash ||= pageHash;
    totalCount ??= pageTotal;
    items.push(...pageItems);
    lastPage = page;
    if (!hasMore) {
      if (items.length !== totalCount) {
        throw eventHistoryPageError(
          "Event history ended before its declared total was emitted.",
        );
      }
      return {
        ...lastPage,
        complete: true,
        cursor: "",
        end: items.length,
        emitted: items.length,
        hasMore: false,
        items,
        nextCursor: "",
        page: 0,
        pageCount: pageNumber + 1,
        pageSize,
        start: 0,
        totalCount: items.length,
      };
    }
    if (seenCursors.has(nextCursor)) {
      throw eventHistoryPageError("Event history cursor repeated.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw eventHistoryPageError(
    `Event history exceeded the ${maxPages}-page completeness bound.`,
  );
}
