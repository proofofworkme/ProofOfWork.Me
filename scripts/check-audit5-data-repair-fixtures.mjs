import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const targets = [
  [3607561, "6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c"],
  [3621078, "8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc"],
  [3747805, "9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0"],
];
const before = {
  format: "proofofwork-audit5-repair-evidence-v1", database: "proof_indexer", otherDatabaseSessions: 0,
  aux: { txid: "4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359",
    status: "confirmed", height: 962992, blockIndex: 1161,
    blockHash: "00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b",
    rawVin: 6, rawVout: 2, inputs: Array.from({ length: 5 }, (_, vin) => ({ vin, valueSats: "600" })),
    outputs: [], anchorLinks: Array.from({ length: 5 }, (_, vin) => ({ vin, valueSats: "600" })), opReturnCount: 0 },
  targetEvents: targets.map(([event_id, txid]) => ({ event_id, txid, protocol: "pwt1",
    kind: "token-listing-sealed-invalid", status: "confirmed", valid: false, amount_sats: 0,
    updated_at: "before", payload: { amount: "0", amountSats: 0, attemptedKind: "seal",
      reason: "work-amo-v6-listing-already-sealed", reasonCode: "work-amo-v6-listing-already-sealed",
      saleAuthorization: { version: "pwt-sale-v8" } } })),
  missingZeroMetadataTxids: targets.map(([, txid]) => txid).sort(),
  protectedSnapshots: [{ snapshot_id: "protected-fixture", resolved: true, row_sha256: "a".repeat(64) }],
  invariants: ["creditBalances", "creditDefinitions", "creditListings", "eventsExceptApprovedMetadata", "transitionCommitments"]
    .map(name => ({ name, rows: 5, sha256: "b".repeat(64) })),
};
const after = structuredClone(before);
after.aux.inputs.push({ vin: 5, valueSats: "600" });
after.aux.outputs = [{ vout: 0, valueSats: "3118" }, { vout: 1, valueSats: "0" }];
after.aux.opReturnCount = 1;
after.missingZeroMetadataTxids = [];
for (const event of after.targetEvents) {
  event.updated_at = "after";
  Object.assign(event.payload, { amountSubatoms: "0", decimals: 16, unitScale: "10000000000000000",
    amountStorageModel: "work-subatoms-v2", precisionModel: "canonical-work-subatoms-v2" });
}
const directory = mkdtempSync(join(tmpdir(), "pow-audit5-repair-fixtures-"));
let checks = 0;
function check(label, original, repaired, succeeds) {
  const first = join(directory, "before.json");
  const second = join(directory, "after.json");
  writeFileSync(first, JSON.stringify(original));
  writeFileSync(second, JSON.stringify(repaired));
  const result = spawnSync(process.execPath, ["scripts/check-audit5-data-repair.mjs", first, second],
    { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status === 0, succeeds, `${label}: ${result.stderr}`);
  checks += 1;
}
try {
  check("exact authorized repair", before, after, true);
  for (const value of ["0", false, null]) {
    const wrongBefore = structuredClone(before);
    const wrongAfter = structuredClone(after);
    wrongBefore.targetEvents[0].payload.amountSats = value;
    wrongAfter.targetEvents[0].payload.amountSats = value;
    check("reject changed numeric-zero JSON type", wrongBefore, wrongAfter, false);
  }
  for (const [label, mutate] of [
    ["live application connection", row => { row.otherDatabaseSessions = 1; }],
    ["changed anchor link", row => { row.aux.anchorLinks[0].valueSats = "601"; }],
    ["changed protected snapshot", row => { row.protectedSnapshots[0].row_sha256 = "c".repeat(64); }],
    ["changed economics", row => { row.invariants[0].sha256 = "d".repeat(64); }],
    ["missing invariant category", row => { row.invariants[0].name = row.invariants[1].name; }],
    ["extra event mutation", row => { row.targetEvents[0].payload.address = "unexpected"; }],
    ["wrong precision scale", row => { row.targetEvents[0].payload.unitScale = "100000000"; }],
    ["extra repair candidate", row => { row.missingZeroMetadataTxids.push("f".repeat(64)); }],
    ["negative fee", row => { row.aux.inputs.forEach(input => { input.valueSats = "1"; }); }],
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    check(label, before, changed, false);
  }
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
