import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
  INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE,
  INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
  buildIncbRangeReplayWitnessManifest,
  canonicalIncbReplaySha256,
  incbRangeReplayWitnessBindingFields,
  incbRangeReplayWitnessMetaKey,
  incbReplayRawSnapshotFingerprint,
  incbReplaySnapshotFingerprint,
  verifyIncbRangeReplayWitnessManifest,
} from "../server/incb-range-replay-witness.mjs";

const hash = (character) => character.repeat(64);
const txid = hash("a");
const bindingId = hash("b");
const throughHash = hash("c");
const previousBlockHash = hash("d");
const blockHash = hash("e");
const canonicalSummaryHash = hash("f");
const createdAt = "2026-07-19T12:00:00.000Z";
const snapshotGeneratedAt = "2026-07-16T10:00:00.000Z";
const exactMintQ8 = "64119182598841787500000";
const rawSnapshotMaterial = {
  consistencyJson: '{"ok": true, "status": "green"}',
  generatedAt: snapshotGeneratedAt,
  indexedThroughBlock: 958_382,
  metricsJson: '{"indexedThroughBlock": 958382}',
  // This is the real legacy failure class: JSON number is rounded. It is
  // committed as raw provenance and is never promoted back into exact Q8.
  payloadJson:
    '{"summaryPayloads": {"workFloor": {"liveNetworkValueSats": 641191825988417.9}}}',
  snapshotId: "snapshot-958382",
  sourceHashesJson: `{"blockScan": "${previousBlockHash}", "canonicalSummary": "${canonicalSummaryHash}"}`,
};

const snapshot = {
  canonicalSummaryHash,
  consistencyOk: true,
  consistencyStatus: "green",
  generatedAt: snapshotGeneratedAt,
  indexedThroughBlock: 958_382,
  payloadBlockHash: previousBlockHash,
  payloadSnapshotId: "snapshot-958382",
  rawSnapshotFingerprint: incbReplayRawSnapshotFingerprint(
    rawSnapshotMaterial,
  ),
  snapshotId: "snapshot-958382",
  sourceBlockHash: previousBlockHash,
  summaryRefreshBlockHash: previousBlockHash,
  summaryRefreshMode: "canonical-summary-refresh",
  workFloorBlockHash: previousBlockHash,
  workFloorHeight: 958_382,
  workFloorSnapshotId: "snapshot-958382",
  workNetworkValueMode:
    INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE,
  workNetworkValueQ8: exactMintQ8,
};
const bond = {
  attachedWorkAmountAtoms: "10000000000000",
  blockHash,
  blockHeight: 958_383,
  blockIndex: 2_421,
  bondRecipientAddress: "bc1pexactwitness",
  bondRecipientAmountSats: "1000",
  bondRecipientOutputs: [{ amountSats: "1000", vout: 0 }],
  bondRecipientVout: 0,
  previousBlockHash,
  txid,
};
const mintPayload = {
  attachedWorkAmountAtoms: bond.attachedWorkAmountAtoms,
  bondRecipientAddress: bond.bondRecipientAddress,
  bondRecipientAmountSats: bond.bondRecipientAmountSats,
  bondRecipientVout: bond.bondRecipientVout,
  issuanceAccountingModel: "canonical-pre-bond-live-network-value-v2",
  issuanceValueSnapshotId: snapshot.snapshotId,
  issuanceValueSnapshotWorkNetworkValueQ8: exactMintQ8,
  minterAddress: bond.bondRecipientAddress,
  sourceBondTxid: txid,
  tokenId: hash("1"),
  txid,
};
const preserveEntry = {
  bond,
  disposition: "preserve",
  mintPayload,
  mintPayloadHash: canonicalIncbReplaySha256(mintPayload),
  reason: "preserve-valid-exact-v2-with-raw-bound-legacy-green-snapshot",
  snapshot,
  snapshotFingerprint: incbReplaySnapshotFingerprint(snapshot),
};
const rederiveEntry = {
  bond: {
    ...bond,
    blockIndex: bond.blockIndex + 1,
    bondRecipientAddress: "bc1prederive",
    bondRecipientAmountSats: "546",
    bondRecipientOutputs: [{ amountSats: "546", vout: 1 }],
    bondRecipientVout: 1,
    txid: hash("2"),
  },
  disposition: "rederive",
  reason: "rederive-missing-or-ambiguous-v2-mint",
};

function makeManifest(entries = [rederiveEntry, preserveEntry]) {
  return buildIncbRangeReplayWitnessManifest({
    bindingId,
    createdAt,
    entries,
    network: "livenet",
    rangeReplayFromHeight: 958_383,
    throughHash,
    throughHeight: 958_590,
  });
}

const manifest = makeManifest();
const metaKey = incbRangeReplayWitnessMetaKey("livenet", bindingId);
const verified = verifyIncbRangeReplayWitnessManifest(manifest, {
  bindingId,
  count: 2,
  hash: manifest.commitment.hash,
  metaKey,
  network: "livenet",
  preserveCount: 1,
  rangeReplayFromHeight: 958_383,
  throughHash,
  throughHeight: 958_590,
});

assert.equal(verified.model, INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL);
assert.equal(verified.entries[0].bond.txid, txid);
assert.equal(verified.entries[0].snapshot.workNetworkValueQ8, exactMintQ8);
assert.equal(verified.entries[0].snapshot.workNetworkValueMode,
  INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE);
assert.equal(verified.entries[1].disposition, "rederive");
assert.equal(INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
  "proof-indexer-canonical-incb-bound-witnesses-v1");
assert.deepEqual(
  incbRangeReplayWitnessBindingFields(manifest, metaKey),
  {
    witnessCount: 2,
    witnessModel: INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    witnessPreserveCount: 1,
    witnessSetHash: manifest.commitment.hash,
    witnessSetMetaKey: metaKey,
    witnessedThroughBlock: 958_590,
    witnessedThroughBlockHash: throughHash,
  },
);

assert.equal(
  canonicalIncbReplaySha256({ b: 2, a: 1 }),
  canonicalIncbReplaySha256({ a: 1, b: 2 }),
  "commitments must be independent of object insertion order",
);
assert.notEqual(
  incbReplayRawSnapshotFingerprint(rawSnapshotMaterial),
  incbReplayRawSnapshotFingerprint({
    ...rawSnapshotMaterial,
    payloadJson: rawSnapshotMaterial.payloadJson.replace(".9", ".8"),
  }),
  "the rounded raw numeric alias remains cryptographically committed",
);
assert.notEqual(
  incbReplayRawSnapshotFingerprint(rawSnapshotMaterial),
  incbReplayRawSnapshotFingerprint({
    ...rawSnapshotMaterial,
    metricsJson: '{"indexedThroughBlock": 958381}',
  }),
  "metrics mutations must change the raw snapshot commitment",
);
assert.equal(
  snapshot.workNetworkValueQ8,
  exactMintQ8,
  "the exact mint Q8 remains authoritative over the rounded JSON number",
);

for (const mutation of [
  (value) => { value.count += 1; },
  (value) => { value.throughHash = hash("9"); },
  (value) => { value.entries[0].bond.bondRecipientAmountSats = "999"; },
  (value) => { value.entries[0].bond.attachedWorkAmountAtoms = "1"; },
  (value) => { value.entries[0].mintPayload.issuanceValueSnapshotWorkNetworkValueQ8 = "1"; },
  (value) => { value.entries[0].snapshot.rawSnapshotFingerprint = hash("8"); },
]) {
  const changed = structuredClone(manifest);
  mutation(changed);
  assert.throws(
    () => verifyIncbRangeReplayWitnessManifest(changed),
    /commitment|counter|fingerprint|reconcile/u,
  );
}

assert.throws(
  () => verifyIncbRangeReplayWitnessManifest(manifest, {
    hash: hash("7"),
  }),
  /binding/u,
);
assert.throws(
  () => makeManifest([preserveEntry, structuredClone(preserveEntry)]),
  /Duplicate/u,
);
assert.throws(
  () => makeManifest([{
    ...preserveEntry,
    mintPayload: { ...mintPayload, txid: hash("3") },
  }]),
  /mint payload commitment/u,
);

const backfillSource = readFileSync(
  new URL("./backfill-proof-indexer.mjs", import.meta.url),
  "utf8",
);
const readerSource = readFileSync(
  new URL("../server/db/proof-index-reader.mjs", import.meta.url),
  "utf8",
);
assert.match(backfillSource, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
assert.match(backfillSource, /LOCK TABLE[\s\S]*proof_indexer\.ledger_snapshots/u);
assert.match(backfillSource, /pwm1:m:\$\{INCEPTION_BOND_MEMO\}/u);
assert.match(backfillSource, /satsFromVoutValue\(output\?\.value\)/u);
assert.match(backfillSource, /committed\) =>[\s\S]*inceptionMemos\[0\]\?\.voutIndex/u);
assert.match(backfillSource, /rederive-whole-multi-recipient-bond/u);
assert.match(backfillSource, /canonicalIncbRangeReplayCompletionWitnesses/u);
assert.match(backfillSource, /rederivedWitnesses/u);
assert.match(backfillSource, /witness\.value->>'model'/u);
assert.match(readerSource, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
assert.match(readerSource, /verifyCanonicalIncbReplayPreservedRows/u);
assert.match(readerSource, /INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE/u);
assert.doesNotMatch(readerSource, /const checkpointLimit = exactCheckpointRequested \? 128/u);
assert.match(readerSource,
  /const checkpointLimit = exactCheckpointRequested \? "" : "LIMIT 1"/u);

console.log(
  JSON.stringify({
    commitment: manifest.commitment.hash,
    model: manifest.model,
    passed: true,
    preserveCount: manifest.preserveCount,
    rederiveCount: manifest.rederiveCount,
  }),
);
