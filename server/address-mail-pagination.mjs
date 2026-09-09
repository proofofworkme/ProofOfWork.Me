export const ADDRESS_MAIL_PAGE_SIZE = 500;

function unavailable(message) {
  return Object.assign(new Error(message), { statusCode: 503, code: "ADDRESS_MAIL_INCOMPLETE" });
}

// The caller keeps every page in one repeatable-read transaction. An empty
// terminal page proves exhaustion; an arbitrary row cap never proves it.
export async function readCompleteAddressMailRows(readPage, { budgetMs = 20_000, now = Date.now } = {}) {
  const started = now(); const rows = []; const seenEvents = new Set();
  let cursor = null; let pages = 0;
  for (;;) {
    if (now() - started > budgetMs) throw unavailable("Complete indexed mailbox exceeded its read budget; retry shortly.");
    const page = await readPage(cursor, ADDRESS_MAIL_PAGE_SIZE);
    if (now() - started > budgetMs) throw unavailable("Complete indexed mailbox exceeded its read budget; retry shortly.");
    if (!Array.isArray(page)) throw unavailable("Indexed mailbox page is unavailable.");
    pages += 1;
    if (!page.length) return { rows, pages, eventCount: seenEvents.size };
    const pageEvents = new Set();
    for (const row of page) {
      const id = String(row.event_id ?? "");
      if (!/^[1-9]\d*$/u.test(id) || seenEvents.has(id)) throw unavailable("Indexed mailbox continuation duplicated or lost an event identity.");
      pageEvents.add(id);
      if (!/^[0-9a-f]{64}$/u.test(row.txid ?? "") || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.effective_time_cursor ?? "")) throw unavailable("Indexed mailbox page has no exact continuation position.");
    }
    const last = page.at(-1);
    const next = { time: last.effective_time_cursor, txid: last.txid, eventId: String(last.event_id) };
    if (cursor && next.time === cursor.time && next.txid === cursor.txid && next.eventId === cursor.eventId) throw unavailable("Indexed mailbox continuation did not advance.");
    for (const id of pageEvents) seenEvents.add(id);
    rows.push(...page); cursor = next;
  }
}
