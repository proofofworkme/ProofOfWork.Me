import assert from "node:assert/strict";
import test from "node:test";
import { canonicalQ16SummarySnapshotSqlEligibility as eligibility } from "../server/db/proof-index-reader.mjs";

test("extracted readiness state preserves every canonical eligibility predicate", () => {
  const original = eligibility("snapshot");
  const extracted = eligibility("snapshot", "readiness_parts");
  assert.notEqual(extracted, original);
  assert.equal(extracted.replaceAll('readiness_parts."workSufficientState"', "snapshot.payload->'workSufficientState'"), original);
  for (const required of ["octet_length(snapshot.payload::text)", "snapshot.source_hashes", "snapshot.indexed_through_block", "witness_block.canonical = true", "witness_transition.complete = true", "closingStateCommitment", "tokenStateCommitment"]) {
    assert.ok(extracted.includes(required), required);
  }
});

test("SQL aliases reject interpolation and retain the unextracted default", () => {
  assert.equal(eligibility("snapshot", ""), eligibility("snapshot"));
  for (const alias of ["x.y", "x; SELECT 1", 'x"', "x--", "1x", "x y"]) {
    assert.throws(() => eligibility(alias), /Invalid canonical/);
    assert.throws(() => eligibility("snapshot", alias), /Invalid extracted/);
  }
});
