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
const coreInputs = [
  ["fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5", 3, "863"],
  ["fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5", 2, "546"],
  ["db836174bde97f027c85553e26af3b896b9d3f04745f32f6f99af631865c7bcc", 2, "546"],
  ["488f31b5ac317123a2383e49eaf06fb6351f117e217bdeb9440795de431175a5", 2, "546"],
  ["3c69d397b2ec43c8eb8a83409b7f2dc979f5b887a307f8a12e053b3ebc545a00", 2, "546"],
  ["a8906b1f9bab7a791a5271a3e9276b8a91e0fb502a49235d4be0c1b8e8a27b79", 2, "546"],
].map(([prevTxid, prevVout, valueSats], vin) => ({ vin, prevTxid, prevVout, valueSats }));
const paymentScript = "76a9144752142b83faf13d526a59212f3f228012890dbe88ac";
const before = {
  format: "proofofwork-audit5-repair-evidence-v1", database: "proof_indexer", otherDatabaseSessions: 0,
  aux: { txid: "4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359",
    status: "confirmed", height: 962992, blockIndex: 1161,
    blockHash: "00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b",
    rawVin: 6, rawVout: 2, inputs: coreInputs.slice(1).map(input => ({ ...input, valueSats: null })),
    outputs: [], anchorLinks: coreInputs.slice(1).map(input => ({ txid: input.prevTxid, vout: input.prevVout,
      spentByTxid: "4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359",
      spentByVin: input.vin, valueSats: input.valueSats, scriptPubKey: paymentScript }))
      .sort((a, b) => a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout), opReturnCount: 0 },
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
after.aux.inputs = structuredClone(coreInputs);
after.aux.outputs = [{ vout: 0, valueSats: "3118", scriptPubKey: paymentScript },
  { vout: 1, valueSats: "0", scriptPubKey: "6a5d081600ff7f8184ec02" }];
after.aux.anchorLinks.push({ txid: coreInputs[0].prevTxid, vout: 3,
  spentByTxid: before.aux.txid, spentByVin: 0, valueSats: "863", scriptPubKey: paymentScript });
after.aux.anchorLinks.sort((a, b) => a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout);
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
    ["forged event identity", row => { row.targetEvents[0].event_id = 3621078; }],
    ["wrong precision scale", row => { row.targetEvents[0].payload.unitScale = "100000000"; }],
    ["extra repair candidate", row => { row.missingZeroMetadataTxids.push("f".repeat(64)); }],
    ["negative fee", row => { row.aux.inputs.forEach(input => { input.valueSats = "1"; }); }],
    ["old synthetic positive fee", row => { row.aux.inputs.forEach(input => { input.valueSats = "600"; }); }],
    ["wrong prevout with same total", row => { row.aux.inputs[0].prevVout = 2; }],
    ["wrong parent transaction", row => { row.aux.inputs[1].prevTxid = "f".repeat(64); }],
    ["reordered input relation", row => { row.aux.inputs[1].vin = 2; }],
    ["redistributed values same fee", row => { row.aux.inputs[0].valueSats = "862"; row.aux.inputs[1].valueSats = "547"; }],
    ["invented parsed OP_RETURN row", row => { row.aux.opReturnCount = 1; }],
    ["changed raw OP_RETURN script", row => { row.aux.outputs[1].scriptPubKey = "6a0116"; }],
    ["changed payment output script", row => { row.aux.outputs[0].scriptPubKey = "51"; }],
    ["missing approved funding link", row => { row.aux.anchorLinks = row.aux.anchorLinks.filter(link => link.spentByVin !== 0); }],
    ["wrong funding amount", row => { row.aux.anchorLinks.find(link => link.spentByVin === 0).valueSats = "864"; }],
    ["wrong funding input ordinal", row => { row.aux.anchorLinks.find(link => link.spentByVin === 0).spentByVin = 6; }],
    ["wrong funding parent", row => { row.aux.anchorLinks.find(link => link.spentByVin === 0).txid = "f".repeat(64); }],
    ["seventh spend link", row => { row.aux.anchorLinks.push({ ...row.aux.anchorLinks[0], vout: 4 }); }],
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    check(label, before, changed, false);
  }
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
