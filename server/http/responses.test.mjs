import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { jsonResponse, writeJsonBody, errorResponse } from "./responses.mjs";

test("actual ServerResponse retains exact UTF-8 byte length for observation", () => {
  const payload = { text: "Proofs 🦾", amount: "9007199254740993" };
  const response = new http.ServerResponse({ method: "GET" });
  jsonResponse(response, 200, payload);
  assert.equal(response.getHeader("content-length"), Buffer.byteLength(JSON.stringify(payload)));
  assert.equal(response.statusCode, 200);
});
test("cached bodies and errors expose their declared byte lengths", () => {
  const response = new http.ServerResponse({ method: "GET" });
  writeJsonBody(response, 200, '{"n":"é"}', "no-store", "hit");
  assert.equal(response.getHeader("content-length"), 10);
  const error = new http.ServerResponse({ method: "GET" });
  errorResponse(error, 503, "Unavailable.");
  assert.equal(error.getHeader("content-length"), Buffer.byteLength(JSON.stringify({ error: "Unavailable.", ok: false })));
});
