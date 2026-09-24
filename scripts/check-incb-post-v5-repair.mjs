import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POST_V5_INCB_ISSUANCE_REPAIR_TARGETS,
  validatePostV5IncbRepairProjection,
} from "../server/incb-post-v5-repair.mjs";

const tokenId = "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const target = POST_V5_INCB_ISSUANCE_REPAIR_TARGETS[1];
const previousBlockHash = target.previousBlockHash;
const address = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const position = {
  txid: target.txid,
  blockHash: target.blockHash,
  blockHeight: target.blockHeight,
  blockIndex: target.blockIndex,
  confirmed: true,
  valid: true,
  protocolVout: 1,
  recordOrdinal: 1,
};
function fixture() {
  return {
    target,
    tokenId,
    previousBlockHash,
    recipient: { address, amountSats: "546", vout: 0 },
    bond: { ...position, kind: "inception-bond", protocol: "pwm1" },
    workTransfers: [{
      ...position,
      kind: "token-transfer",
      recipientAddress: address,
      amountSubatoms: "18000000000000000000000",
    }],
    mint: {
      ...position,
      kind: "token-mint",
      protocol: "pwt1",
      tokenId,
      sourceBondTxid: target.txid,
      sourceKind: "inception-bond",
      validationMode: "canonical-incb-bond-projection",
      amountSats: 0,
      minterAddress: address,
      bondRecipientAddress: address,
      bondRecipientVout: 0,
      bondRecipientAmountSats: "546",
      directProofIssuanceUnits: "546",
      attachedWorkAmountSubatoms: "18000000000000000000000",
      attachedWorkLiveValueAtSendQ8: "72081468839406099752608158",
      attachedWorkIssuanceUnits: "720814688394060997",
      confirmedIssuanceUnits: "720814688394061543",
      amount: "720814688394061543",
      issuanceNetworkValueQ8: "72081468839406154352608158",
      issuanceDustQ8: "52608158",
      issuanceValueSnapshotBlockHeight: target.blockHeight - 1,
      issuanceValueSnapshotBlockHash: previousBlockHash,
      issuanceValueSnapshotWorkNetworkValueQ8: target.workNetworkValueQ8,
      issuanceCheckpointBlockHeight: target.blockHeight,
      issuanceCheckpointBlockHash: target.blockHash,
      issuanceCheckpointBlockIndex: target.blockIndex,
    },
  };
}

test("exact post-V5 repair target conserves direct proofs and Q16 WORK without duplicate value", () => {
  const witness = validatePostV5IncbRepairProjection(fixture());
  assert.equal(witness.amount, "720814688394061543");
  assert.equal(witness.fixedValueQ8, "72081468839406154352608158");
  assert.equal(witness.directProofSats, "546");
  assert.equal(witness.attachedWorkSubatoms, "18000000000000000000000");
});

test("first post-V5 bond pins the independent predecessor and exact issued units", () => {
  const first = fixture();
  const earlier = POST_V5_INCB_ISSUANCE_REPAIR_TARGETS[0];
  first.target = earlier;
  first.previousBlockHash = earlier.previousBlockHash;
  for (const item of [first.bond, first.mint, first.workTransfers[0]]) {
    item.txid = earlier.txid;
    item.blockHash = earlier.blockHash;
    item.blockHeight = earlier.blockHeight;
    item.blockIndex = earlier.blockIndex;
  }
  first.workTransfers[0].amountSubatoms = earlier.attachedWorkSubatoms;
  Object.assign(first.mint, {
    sourceBondTxid: earlier.txid,
    attachedWorkAmountSubatoms: earlier.attachedWorkSubatoms,
    attachedWorkLiveValueAtSendQ8: earlier.attachedWorkValueQ8,
    attachedWorkIssuanceUnits: "352529922613",
    confirmedIssuanceUnits: earlier.issuanceUnits,
    amount: earlier.issuanceUnits,
    issuanceNetworkValueQ8: earlier.fixedValueQ8,
    issuanceDustQ8: "49398739",
    issuanceValueSnapshotBlockHeight: earlier.blockHeight - 1,
    issuanceValueSnapshotBlockHash: earlier.previousBlockHash,
    issuanceValueSnapshotWorkNetworkValueQ8: earlier.workNetworkValueQ8,
    issuanceCheckpointBlockHeight: earlier.blockHeight,
    issuanceCheckpointBlockHash: earlier.blockHash,
    issuanceCheckpointBlockIndex: earlier.blockIndex,
  });
  const witness = validatePostV5IncbRepairProjection(first);
  assert.equal(witness.amount, earlier.issuanceUnits);
  assert.equal(witness.fixedValueQ8, earlier.fixedValueQ8);
});

test("post-V5 repair rejects rogue targets, detached or unaccepted WORK, and wrong H-1/value", () => {
  for (const mutate of [
    (f) => { f.target = { ...f.target, txid: "a".repeat(64) }; },
    (f) => { f.mint.sourceBondTxid = "a".repeat(64); },
    (f) => { f.mint.validationMode = "canonical-first-party-state"; },
    (f) => { f.mint.amountSats = 546; },
    (f) => { f.mint.issuanceValueSnapshotBlockHash = "a".repeat(64); },
    (f) => { f.mint.issuanceValueSnapshotWorkNetworkValueQ8 = "1"; },
    (f) => { f.workTransfers[0].amountSubatoms = "1"; },
    (f) => { f.workTransfers[0].valid = false; },
    (f) => { f.workTransfers.push({ ...f.workTransfers[0] }); },
    (f) => { f.mint.amount = "720814688394061544"; },
    (f) => { f.mint.issuanceNetworkValueQ8 = "72081468839406154352608157"; },
  ]) {
    const caseValue = fixture();
    mutate(caseValue);
    assert.throws(() => validatePostV5IncbRepairProjection(caseValue), /Post-V5 INCB repair/u);
  }
});
