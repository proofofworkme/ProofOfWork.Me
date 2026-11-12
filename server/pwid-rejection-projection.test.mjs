import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPwidRejectionProjection } from "./pwid-rejection-projection.mjs";
const rejection = {
  protocol: "pwid1", valid: false, kind: "id-seal-invalid",
  _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true,
  workAmoV5RawDecodeValid: true, payload: "pwid1:seal5:fixture",
  reason: "rejected", reasonCode: "rejected", amountSats: "0",
  workAmoV5ReplayOutcome: { kind: "pwid1-invalid", valid: false, reasonCode: "rejected" },
  workAmoV5ReplayOutput: { projection: { kind: "id-seal", valid: false } },
  workAmoV5ReplayRawWitness: { fixture: "immutable" },
};
test("semantic rejection has canonical invalid kind and retains every evidence field", () => {
  for (const kind of ["id-seal", "id-register", "id-update", "id-transfer",
    "id-list", "id-buy", "id-delist"]) {
    const before = structuredClone(rejection);
    const result = canonicalPwidRejectionProjection(rejection, kind);
    assert.deepEqual(result, { ...before, kind: "id-event-invalid", attemptedKind: kind });
    assert.deepEqual(rejection, before);
    assert.equal(result.workAmoV5ReplayOutput, rejection.workAmoV5ReplayOutput);
    assert.deepEqual(canonicalPwidRejectionProjection(result, kind), result);
  }
});
test("raw malformed candidates use the exact attempted action, not a generic suffix", () => {
  for (const [action, expected] of Object.entries({ r: "register", r2: "register",
    u: "update", t: "transfer", buy5: "buy", list5: "list", seal5: "seal",
    delist5: "delist", wat: "wat", "": "event" })) {
    assert.equal(canonicalPwidRejectionProjection({ ...rejection, payload: `pwid1:${action}:x` },
      "protocol-event-invalid").attemptedKind, `id-${expected}`);
  }
  assert.equal(canonicalPwidRejectionProjection({ ...rejection, workAmoV5RawDecodeValid: false },
    "protocol-event-invalid").attemptedKind, "id-event");
});
test("cannot normalize valid, derived, unbound or unrelated records", () => {
  for (const mutation of [{valid: true}, {protocol: "pwt1"}, {_workAmoV5ReplayBound: false},
    {workAmoV5RawCandidate: false}, {workAmoV5ReplayOutcome: {kind: "pwid1-valid", valid: true}}]) {
    assert.throws(() => canonicalPwidRejectionProjection({ ...rejection, ...mutation }, "id-seal"));
  }
  for (const kind of [undefined, "", "token-transfer", "id-seal-invalid"]) {
    assert.throws(() => canonicalPwidRejectionProjection(rejection, kind));
  }
});

test("four audited historical projections fail strictly before and qualify after normalization", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { qualifiedPostActivationPwidOutcome } = await import("./id-registry-audit-contract.mjs");
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/pwid-invalid-projections-20261112.json", import.meta.url)));
  assert.equal(fixtures.length, 4);
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  for (const fixture of fixtures) {
    const p = fixture.payload;
    const w = p.workAmoV5RawScriptWitness;
    const semanticKind = p.workAmoV5ReplayOutput.projection.kind;
    const carrier = {
      txid: fixture.txid, blockHeight: fixture.height, blockIndex: p.blockIndex,
      protocolVout: p.protocolVout, recordOrdinal: p.recordOrdinal,
      rawPayload: p.payload, rawPayloadHex: w.payloadHex,
      rawPayloadSha256: hash(Buffer.from(w.payloadHex, "hex")),
      scriptPubKeyHex: w.scriptPubKeyHex,
      scriptPubKeySha256: hash(Buffer.from(w.scriptPubKeyHex, "hex")),
      rawDecodeValid: w.decodeValid, rawDecodeReasonCode: w.reasonCode, rawDecodeDetail: w.decodeDetail,
    };
    const outcome = { ...carrier, attributedRegistrySats: Number(p.amountSats),
      consensusKind: p.workAmoV5ReplayOutcome.kind, projectionKind: semanticKind,
      rawCandidate: true, reasonCode: p.reasonCode, semanticKind, valid: false };
    const toRow = (projected) => ({
      amountSats: Number(projected.amountSats), attemptedKind: projected.attemptedKind,
      kind: projected.kind, valid: false,
      eventKey: ["pwid1", projected.kind, fixture.txid, "v5", fixture.height,
        p.blockIndex, p.protocolVout, p.recordOrdinal].join(":"),
      rawDecodeValid: w.decodeValid, rawDecodeReasonCode: w.reasonCode,
      rawScriptWitnessPresent: true, rawScriptDecodeValid: w.decodeValid,
      rawScriptDecodeDetail: w.decodeDetail, rawScriptPayloadHex: w.payloadHex,
      rawScriptPubKeyHex: w.scriptPubKeyHex, rawScriptReasonCode: w.reasonCode,
      reasonCode: projected.reasonCode, replayOutcomeReasonCode: projected.workAmoV5ReplayOutcome.reasonCode,
      payloadReasonCode: projected.reasonCode, payloadReason: projected.reason,
      storedRawPayloadPresent: true, storedRawPayload: projected.payload,
      storedRawPayloadSha256: hash(projected.payload),
      payloadRawPayloadPresent: true, payloadRawPayload: projected.payload,
      payloadRawPayloadSha256: hash(projected.payload),
      replayMetadataPresent: true, replayBound: projected._workAmoV5ReplayBound,
      replayRawCandidate: projected.workAmoV5RawCandidate,
      replayOutcomeKind: projected.workAmoV5ReplayOutcome.kind,
      replayOutcomeValid: projected.workAmoV5ReplayOutcome.valid,
      validationErrors: fixture.errors,
    });
    const qualify = (row) => qualifiedPostActivationPwidOutcome({ acceptedEvent: null, carrier, outcome, row });
    assert.throws(() => qualify(toRow(p)), /exact canonical replay rejection/);
    const fixed = canonicalPwidRejectionProjection(p, semanticKind);
    assert.equal(qualify(toRow(fixed)), "post-activation-invalid-replay-bound");
    const {kind: oldKind, attemptedKind: oldAttempt, ...oldEvidence} = p;
    const {kind: newKind, attemptedKind: newAttempt, ...newEvidence} = fixed;
    assert.deepEqual(newEvidence, oldEvidence);
    for (const mutation of [{ amountSats: 1 }, { replayBound: false },
      { attemptedKind: "id-event" }, { payloadReason: "different" }]) {
      assert.throws(() => qualify({ ...toRow(fixed), ...mutation }));
    }
  }
});
