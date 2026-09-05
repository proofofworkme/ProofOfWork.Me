import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const before = JSON.parse(readFileSync(process.argv[2], "utf8"));
const after = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : null;
const expected = new Map([
  [3607561, "6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c"],
  [3621078, "8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc"],
  [3747805, "9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0"],
]);
const additions = {
  amountSubatoms: "0", decimals: 16, unitScale: "10000000000000000",
  amountStorageModel: "work-subatoms-v2", precisionModel: "canonical-work-subatoms-v2",
};
function validate(evidence, repaired) {
  assert.equal(evidence.format, "proofofwork-audit5-repair-evidence-v1");
  assert.equal(evidence.database, "proof_indexer");
  assert.equal(evidence.otherDatabaseSessions, 0, "Every application reader/writer must remain stopped.");
  assert.equal(evidence.aux.txid, "4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359");
  assert.equal(evidence.aux.status, "confirmed");
  assert.equal(evidence.aux.height, 962992);
  assert.equal(evidence.aux.blockIndex, 1161);
  assert.equal(evidence.aux.blockHash, "00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b");
  assert.equal(evidence.aux.rawVin, 6);
  assert.equal(evidence.aux.rawVout, 2);
  assert.equal(evidence.aux.inputs.length, repaired ? 6 : 5);
  assert.equal(evidence.aux.outputs.length, repaired ? 2 : 0);
  assert.equal(evidence.aux.anchorLinks.length, 5);
  if (repaired) {
    assert.equal(evidence.aux.opReturnCount, 1);
    const inputs = evidence.aux.inputs.reduce((sum, input) => {
      assert.match(input.valueSats, /^(0|[1-9][0-9]*)$/u);
      return sum + BigInt(input.valueSats);
    }, 0n);
    const outputs = evidence.aux.outputs.reduce((sum, output) => sum + BigInt(output.valueSats), 0n);
    assert.equal(outputs, 3118n);
    assert.ok(inputs >= outputs, "Repaired inputs cannot imply a negative fee.");
  }
  assert.equal(evidence.targetEvents.length, 3);
  for (const event of evidence.targetEvents) {
    assert.equal(expected.get(event.event_id), event.txid);
    assert.equal(event.protocol, "pwt1");
    assert.equal(event.kind, "token-listing-sealed-invalid");
    assert.equal(event.status, "confirmed");
    assert.equal(event.valid, false);
    assert.equal(event.amount_sats, 0);
    assert.equal(event.payload.amount, "0");
    assert.equal(event.payload.amountSats, 0);
    assert.equal(event.payload.attemptedKind, "seal");
    assert.equal(event.payload.reason, "work-amo-v6-listing-already-sealed");
    assert.equal(event.payload.reasonCode, "work-amo-v6-listing-already-sealed");
    assert.equal(event.payload.saleAuthorization.version, "pwt-sale-v8");
    for (const [key, value] of Object.entries(additions)) {
      if (repaired) assert.equal(event.payload[key], value);
      else assert.equal(Object.hasOwn(event.payload, key), false);
    }
  }
  assert.deepEqual(evidence.missingZeroMetadataTxids,
    repaired ? [] : [...expected.values()].sort());
  assert.ok(evidence.protectedSnapshots.length > 0);
  assert.ok(evidence.protectedSnapshots.every(row => row.resolved && /^[0-9a-f]{64}$/u.test(row.row_sha256)));
  assert.deepEqual(evidence.invariants.map(row => row.name).sort(), [
    "creditBalances", "creditDefinitions", "creditListings", "eventsExceptApprovedMetadata", "transitionCommitments",
  ]);
  for (const row of evidence.invariants) {
    assert.ok(Number.isSafeInteger(row.rows) && row.rows >= 0);
    assert.match(row.sha256, /^[0-9a-f]{64}$/u);
  }
}
validate(before, false);
if (after) {
  validate(after, true);
  assert.deepEqual(after.aux.anchorLinks, before.aux.anchorLinks, "All five existing spend links must remain identical.");
  assert.deepEqual(after.invariants, before.invariants, "Event/economic/transition commitments changed beyond the approved metadata.");
  assert.deepEqual(after.protectedSnapshots, before.protectedSnapshots, "Immutable H-1/seed evidence changed.");
  for (const event of after.targetEvents) {
    const original = before.targetEvents.find(row => row.event_id === event.event_id);
    const permitted = { ...original, updated_at: event.updated_at, payload: { ...original.payload, ...additions } };
    assert.deepEqual(event, permitted, "An invalid-zero event changed outside five precision keys and update timestamp.");
  }
}
console.log(JSON.stringify({ ok: true, phase: after ? "post-repair-before-bootstrap" : "stopped-writer-preflight",
  auxiliaryTransactions: 1, invalidZeroEvents: 3, preservedAnchorLinks: 5,
  note: "Existing repair writers additionally verify exact hydrated Core details and strict atomic invariants. Resume writers only after this check and required bootstrap gates." }, null, 2));
