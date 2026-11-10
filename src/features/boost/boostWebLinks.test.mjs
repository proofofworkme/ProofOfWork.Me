import test from "node:test";
import assert from "node:assert/strict";
import { boostWebLinks } from "./boostWebLinks.mjs";

test("Boost preserves exact text while linking complete web URLs", () => {
  const url = "https://jobs.proofofwork.me/?job=7956e68fc3b98b62b2d7d733712b73e4e1e74b73da44bb470f0c51c2303adb5e";
  const text = `Open (${url}). https://example.com/a(b) https://example.com/@alice/$WORK/#tag`;
  const parts = boostWebLinks(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), [url, "https://example.com/a(b)", "https://example.com/@alice/$WORK/#tag"]);
});

test("Boost never activates unsupported schemes, credentials or nested URLs", () => {
  const text = "javascript:https://example.com ftp://example.com/https://other.example data:text/html https://user:secret@example.com https:// http://example.com";
  const parts = boostWebLinks(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), ["http://example.com/"]);
});
