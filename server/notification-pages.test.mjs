import test from "node:test";
import assert from "node:assert/strict";
import { notificationAction, notificationPayload } from "./notifications.mjs";

const txid = "a".repeat(64), address = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const event = fields => ({ network: "livenet", txid, protocol: "pwm1", kind: "mail", eventId: 1,
  protocolVout: 1, recordOrdinal: 0, confirmed: true, status: "confirmed", confirmationStatus: "confirmed",
  valid: true, actor: address, recipientAddress: address, ...fields });
const encode = value => Buffer.from(value).toString("base64url");

test("Pages body, MIME attachment and exact legacy carrier forms use the Browser destination", () => {
  const fixtures = [
    { memo: "<!doctype html><html><body>Page</body></html>" },
    { memo: "  <main><h1>Page fragment</h1></main>\n" },
    { kind: "file", memo: "", attachment: { name: "page.html", mime: "text/html" } },
    { kind: "file", attachment: { name: "page", mime: "TEXT/HTML; charset=utf-8" } },
    { kind: "attachment", attachment: { name: "page", mime: "application/xhtml+xml" } },
    { kind: "attachment", attachment: { name: "page.XHTML", mime: "application/octet-stream" } },
    { kind: "attachment", payload: `pwm1:a:${encode("text/html")}:${encode("page")}:8:${"b".repeat(64)}:0/1:PGI-eDwvYj4` },
    { kind: "file", detail: "page.html · 8 B · application/octet-stream" },
    { kind: "file", detail: "page · 8 B · text/html" },
    { kind: "file", tags: ["application/xhtml+xml"] },
  ];
  for (const fixture of fixtures) {
    const result = notificationAction(event(fixture), address);
    assert.equal(result.app, "Pages", JSON.stringify(fixture));
    assert.deepEqual(result.target, { workspace: "browser", txid });
    assert.equal(result.status, "confirmed");
  }
});

test("Pages classification preserves one compound transaction and does not infer HTML from arbitrary prose", () => {
  const mail = event({ subject: "Page title", memo: "" });
  const file = event({ eventId: 2, protocolVout: 2, kind: "file", attachment: { name: "page.html", mime: "text/html" } });
  const payload = notificationPayload({ network: "livenet", items: [mail, file], totalCount: 1, complete: true }, address);
  assert.equal(payload.items.length, 1); assert.equal(payload.items[0].app, "Pages");
  assert.equal(payload.items[0].actions.length, 2); assert.equal(payload.items[0].id, `livenet:${txid}`);
  for (const fixture of [
    { memo: "A note about text/html and page.html." },
    { subject: "page.html", memo: "Plain message" },
    { kind: "file", attachment: { name: "notes.txt", mime: "text/plain" }, memo: "" },
  ]) assert.notEqual(notificationAction(event(fixture), address).app, "Pages");
  assert.equal(notificationAction(event({ kind: "file", valid: false, attachment: { name: "page.html", mime: "text/html" } }), address).status, "invalid");
});
