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

test("bare domains normalize only hrefs, preserving case, paths and punctuation", () => {
  const text = "PROOFOFWORK.ME Boost.ProofOfWork.Me/Path?Case=Yes#part www.example.com, (example.com). example.com/a(b).";
  const parts = boostWebLinks(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), [
    "https://proofofwork.me/", "https://boost.proofofwork.me/Path?Case=Yes#part",
    "https://www.example.com/", "https://example.com/", "https://example.com/a(b)",
  ]);
  assert.equal(parts[0].text, "PROOFOFWORK.ME");
});

test("emails, unsafe schemes, malformed hosts and native .pow names remain literal", () => {
  const text = "user@example.com user@PROOFOFWORK.ME javascript:example.com data:text/html,example.com " +
    "file:///example.com ftp://example.com https://user:pass@example.com //example.com /example.com " +
    "-example.com foo..example.com example.com_bad example.com@evil.com alice.pow sub.alice.pow example.com:99999 example.com:abc javascript:alert(example.com)";
  const parts = boostWebLinks(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.href), []);
});

test("inline and fenced code remain literal, including segmented tags", async () => {
  const { boostWebLinkCodeRanges } = await import("./boostWebLinks.mjs");
  const { parseBoostText } = await import("../../shared/protocol/boostText.mjs");
  const tick = String.fromCharCode(96);
  const text = "Open PROOFOFWORK.ME\n" + tick + "$WORK PROOFOFWORK.ME https://example.com" + tick +
    "\n~~~text\n#tag example.com\n~~~\n" + tick.repeat(3) + "\nexample.com\n" + tick.repeat(3) + "\nAfter example.org";
  const codeRanges = boostWebLinkCodeRanges(text);
  let offset = 0;
  const parts = parseBoostText(text).flatMap(segment => {
    const start = offset; offset += segment.text.length;
    return segment.kind === "text" ? boostWebLinks(segment.text, { codeRanges, sourceOffset: start }) : [{ text: segment.text }];
  });
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), ["https://proofofwork.me/", "https://example.org/"]);
});

test("web paths retain tokens without changing native identity and DNS routing", async () => {
  const { parseBoostText } = await import("../../shared/protocol/boostText.mjs");
  const text = "PROOFOFWORK.ME/Path?x=1#Tag @alice alice@proofofwork.me alice.pow $WORK";
  const segments = parseBoostText(text);
  assert.equal(segments.map(part => part.text).join(""), text);
  assert.deepEqual(segments.filter(part => part.kind !== "text").map(part => part.kind), ["mention", "mention", "dns", "cashtag"]);
  assert.equal(boostWebLinks(segments[0].text)[0].href, "https://proofofwork.me/Path?x=1#Tag");
});

test("HTML remains inert text and generated destinations are HTTP(S) only", () => {
  const text = '<script>alert(1)</script> "PROOFOFWORK.ME" https://EXAMPLE.COM/a?b=%22 c.example.com:8443/path';
  const parts = boostWebLinks(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  for (const part of parts.filter(part => part.href)) {
    const url = new URL(part.href);
    assert.ok(["http:", "https:"].includes(url.protocol));
    assert.equal(url.username + url.password, "");
  }
});
