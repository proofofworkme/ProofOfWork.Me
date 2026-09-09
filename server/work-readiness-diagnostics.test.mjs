import assert from "node:assert/strict";
import test from "node:test";
import { workAmoV8StatusFromEvidence } from "./work-amo-v8.mjs";
import { qualifyWorkReadinessStatus } from "./work-readiness-diagnostics.mjs";

test("read diagnostics preserve every admission and activation field", () => {
  const unavailable = {
    ...workAmoV8StatusFromEvidence({}),
    reasonCode: "work-amo-v8-declaration-evidence-unavailable",
  };
  for (const [exactTipVerified, migrationReadinessAvailable, reasonCode] of [
    [false, false, "work-amo-v8-exact-readiness-sweep-unavailable"],
    [true, false, "work-amo-v8-migration-readiness-unavailable"],
    [true, true, "work-amo-v8-precision-migration-not-ready"],
  ]) {
    const qualified = qualifyWorkReadinessStatus(unavailable, {
      declarationEvidenceVerified: true, exactTipVerified, migrationReadinessAvailable,
    });
    assert.equal(qualified.reasonCode, reasonCode);
    for (const [key, value] of Object.entries(unavailable)) {
      if (key !== "reasonCode") assert.deepEqual(qualified[key], value, key);
    }
    assert.equal(qualified.protocolWritesEnabled, false);
    assert.equal(qualified.writeAdmission, false);
  }
});

test("unknown declaration, mismatched evidence and open status are never reclassified", () => {
  for (const status of [
    { reasonCode: "work-amo-v8-declaration-evidence-mismatch", protocolWritesEnabled: false },
    { reasonCode: "", protocolWritesEnabled: true },
  ]) assert.equal(qualifyWorkReadinessStatus(status, { declarationEvidenceVerified: true }), status);
  const unavailable = { reasonCode: "work-amo-v8-declaration-evidence-unavailable" };
  assert.equal(qualifyWorkReadinessStatus(unavailable), unavailable);
});
