import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const archive = new URL("../output/historical/2026-05-13/", import.meta.url);

test("the original report, data, and all ten chart files retain their archived bytes", () => {
  const entries = readFileSync(new URL("SHA256SUMS", archive), "utf8").trim().split("\n");
  assert.equal(entries.length, 12);
  const names = new Set();
  for (const entry of entries) {
    const match = /^([0-9a-f]{64})  (proofofwork-computer-[a-z.-]+)$/.exec(entry);
    assert.ok(match, "archive manifest must name only model artifacts");
    const [, expected, name] = match;
    assert.ok(!names.has(name), "archive manifest entries must be unique");
    names.add(name);
    const bytes = readFileSync(new URL(name, archive));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
  assert.ok(names.has("proofofwork-computer-agent-adoption-model.md"));
  assert.ok(names.has("proofofwork-computer-growth-model.json"));
  for (const chart of ["blockspace", "compounding", "dollar-growth", "product-split", "volatility"]) {
    for (const extension of ["svg", "png"]) {
      assert.ok(names.has(`proofofwork-computer-model-${chart}.${extension}`));
    }
  }
});
