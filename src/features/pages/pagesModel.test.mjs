import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PAGE_BYTES, decodePageFile, identityCardHtml, insertPageMarkup, pageByteLength,
  pageFileName, pagesStorageKey, pageTemplateHtml, validatePageHtml, validatePagesDrafts,
} from "./pagesModel.mjs";

test("HTML file decoding retains BOM, Unicode, and trailing whitespace exactly", () => {
  const html = "\ufeff<!doctype html><p>Proofs ∞ 🧱</p>\r\n  \n";
  const bytes = new TextEncoder().encode(html);
  assert.equal(decodePageFile(bytes), html);
  assert.deepEqual(new TextEncoder().encode(decodePageFile(bytes)), bytes);
  assert.throws(() => decodePageFile(Uint8Array.of(0xff, 0xfe)), /UTF-8/);
  assert.throws(() => decodePageFile(new Uint8Array(MAX_PAGE_BYTES + 1)), /at most/);
});

test("publication limit uses UTF-8 bytes rather than source character count", () => {
  const html = "🧱".repeat(25_000);
  assert.equal(pageByteLength(html), MAX_PAGE_BYTES);
  assert.equal(validatePageHtml(html), html);
  assert.throws(() => validatePageHtml(html + " "), /exceeds/);
  assert.throws(() => validatePageHtml("  \n"), /Add HTML/);
});

test("draft namespaces retain separate account and network scopes", () => {
  assert.notEqual(pagesStorageKey("livenet", "one"), pagesStorageKey("livenet", "two"));
  assert.notEqual(pagesStorageKey("livenet", "one"), pagesStorageKey("testnet4", "one"));
  assert.match(pagesStorageKey("livenet"), /disconnected$/);
  assert.throws(() => pagesStorageKey("bad"), /Unknown/);
});

test("restored draft inventories reject duplicates, unknown active draft, and bad source evidence", () => {
  const draft = { id: "one", title: "Page", html: "", updatedAt: 1 };
  const valid = { version: 1, activeId: "one", drafts: [draft] };
  assert.deepEqual(validatePagesDrafts(valid), valid);
  assert.throws(() => validatePagesDrafts({ ...valid, activeId: "missing" }), /missing/);
  assert.throws(() => validatePagesDrafts({ ...valid, drafts: [draft, draft] }), /invalid/);
  assert.throws(() => validatePagesDrafts({ ...valid, drafts: [{ ...draft, origin: { txid: "bad" } }] }), /evidence/);
  assert.throws(() => validatePagesDrafts({ ...valid, drafts: [{ ...draft, html: "a".repeat(MAX_PAGE_BYTES + 1) }] }), /size limit/);
});

test("identity cards escape confirmed data and insert outside the existing page body", () => {
  const card = identityCardHtml({ id: '<img src=x onerror="alert(1)">@proofofwork.me', ownerAddress: 'owner"<', receiveAddress: 'receiver"&' });
  assert.ok(!card.includes("<img"));
  assert.match(card, /&lt;img/);
  assert.match(card, /receiver&quot;&amp;/);
  assert.match(card, /href="https:\/\/computer\.proofofwork\.me\/"/);
  assert.ok(!card.includes("?address="));
  assert.match(card, /confirmed receiver/iu);
  assert.throws(() => identityCardHtml({ id: "id" }), /incomplete/);
  assert.equal(insertPageMarkup("<body>Hello</body>", "CARD"), "<body>HelloCARD</body>");
  assert.equal(insertPageMarkup("Hello", "CARD", { start: 1, end: 4 }), "HCARDo");
});

test("starter app is self contained and HTML filenames cannot become paths", () => {
  const app = pageTemplateHtml("<unsafe>", true);
  assert.match(app, /&lt;unsafe&gt;/);
  assert.match(app, /<script>/);
  assert.ok(!app.includes("<script src="));
  assert.equal(pageFileName(" ../app\\name : "), "..-app-name -.html");
});
