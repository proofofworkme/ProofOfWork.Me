import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { readCompleteAddressMailRows, ADDRESS_MAIL_PAGE_SIZE } from "../server/address-mail-pagination.mjs";

const row = (n) => ({ event_id: n, txid: n.toString(16).padStart(64, "0"), effective_time_cursor: "2026-09-08T00:00:00.000001Z", subject: `Message ${n}`, attached_credit_events: [{ amountSubatoms: "9007199254740993" }], status: n % 7 ? "confirmed" : "dropped" });

test("mail collection exhausts more than 1000 records without altering exact attachments or terminal history", async () => {
  const source = Array.from({ length: 1502 }, (_, n) => row(1502 - n)); const cursors = [];
  const result = await readCompleteAddressMailRows(async (cursor, limit) => {
    cursors.push(cursor);
    assert.equal(limit, ADDRESS_MAIL_PAGE_SIZE);
    return source.filter((item) => !cursor || item.txid < cursor.txid).slice(0, limit);
  });
  assert.equal(result.rows.length, 1502); assert.equal(result.eventCount, 1502); assert.equal(result.pages, 5);
  assert.deepEqual(result.rows, source);
  assert.equal(cursors[1].eventId, "1003");
  assert.equal(result.rows.at(-1).attached_credit_events[0].amountSubatoms, "9007199254740993");
  assert.ok(result.rows.some((item) => item.status === "dropped"));
});

test("mail returns complete empty only after a successful terminal page", async () => {
  assert.deepEqual(await readCompleteAddressMailRows(async () => []), { rows: [], pages: 1, eventCount: 0 });
  await assert.rejects(readCompleteAddressMailRows(async () => null), /unavailable/u);
  await assert.rejects(readCompleteAddressMailRows(async () => { throw new Error("database unavailable"); }), /database unavailable/u);
});

test("mail page failure, repeat, lost identity and timeout cannot return a partial success", async () => {
  let calls = 0;
  await assert.rejects(readCompleteAddressMailRows(async () => ++calls === 1 ? [row(2)] : Promise.reject(new Error("lost snapshot"))), /lost snapshot/u);
  await assert.rejects(readCompleteAddressMailRows(async () => [row(2)]), /duplicated/u);
  await assert.rejects(readCompleteAddressMailRows(async () => [{ ...row(1), event_id: null }]), /identity/u);
  await assert.rejects(readCompleteAddressMailRows(async () => [{ ...row(1), effective_time_cursor: "2026-09-08T00:00:00.000Z" }]), /exact continuation/u);
  let time = 0;
  await assert.rejects(readCompleteAddressMailRows(async () => [row(1)], { budgetMs: 10, now: () => time += 11 }), /read budget/u);
});

test("mail SQL keeps every page and dropped witness in one read-only snapshot", () => {
  const source = readFileSync(new URL("../server/db/proof-index-reader.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function proofIndexAddressMailPayload(");
  const reader = source.slice(start, source.indexOf("export async function proofIndexBoostAuthorityWitnesses", start));
  assert.match(reader, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(reader, /readCompleteAddressMailRows/u);
  assert.match(reader, /LIMIT \$8/u);
  assert.doesNotMatch(reader, /LIMIT 1000|await pool\.query/u);
  assert.match(reader, /cursor\?\.time/u);
  assert.match(reader, /client\.query\("ROLLBACK"\)/u);
  assert.match(reader, /complete: true/u);
});

test("canonical mail body bytes, including HTML newline and whitespace-only bodies, are preserved", () => {
  const source = readFileSync(new URL("../server/db/proof-index-reader.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function mailMemoFromEvent(");
  const end = source.indexOf("\nfunction ", start + 1);
  const context = vm.createContext({ subjectOnlyMailBody: (text) => /^Subject:\s*/iu.test(text.trim()) });
  vm.runInContext(`${source.slice(start, end)};this.readMemo = mailMemoFromEvent;`, context);
  for (const body of ["<html>Welcome</html>\n", "HAPPY FATHERS DAY ", " ", "\nhello\n", "multibyte Ω\n"]) {
    assert.equal(context.readMemo({}, { body }), body);
    assert.equal(context.readMemo({ body_text: body }, {}), body);
  }
});
