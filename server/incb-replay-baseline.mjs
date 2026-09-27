// Reviewed independent replay lineage. Production retains its original baseline.
// This profile derives from the green H963781 source row plus the exact native
// H963782 issuance; it is not inferred from the H968124 checkpoint being tested.
export const INCB_REPLAY_BASELINE_MODEL = "canonical-incb-reviewed-replay-baseline-v1";
const PIN = Object.freeze({
  bindingId: "15638b38fe701044afc5e92eadaf6f29dcb787be4e12b9db4d8ffbe551e629de",
  witnessSetHash: "ebccb0dd8a672b85da5ce0777f5c33f555f1cd9628b08cfa3de5153a471733a5",
  referenceSnapshotId: "6838bcd9ef74c5b9b408ca2f",
  referenceRowSha256: "dc478211126a97ff58aa929062b6643792c907fb51ad52ac5ffe573b47ce4a22",
  referenceIssuanceTxid: "b00b9451bded7d2b7d339556ad2dc5d375e5b52ad877a1d3e2b29149dfc72ccf",
});
const add = (a, b) => (BigInt(a) + BigInt(b)).toString();
export const REVIEWED_INCB_REPLAY_BASELINE = Object.freeze({
  acceptedMints: 47,
  attachedWorkIssuanceUnits: add("210841369556871205", "352529922613"),
  confirmedSupply: add("210841369556898591", "352529923159"),
  directProofIssuanceUnits: add("27386", "546"),
  issuanceDustQ8: add("2014940890", "49398739"),
  networkValueQ8: add("21084136955689861114940890", "35252992315949398739"),
  parentBondEvents: 47,
});
function checkpointMatches(height, hash) {
  return Number.isSafeInteger(height) && height >= 963782 &&
    /^[0-9a-f]{64}$/u.test(hash ?? "") &&
    (height !== 968124 || hash === "000000000000000000011837b393ac8b60920238da37902390ad8629e76002f6");
}
// Call only after the API has verified the current active database-bound replay.
export function reviewedIncbReplayBaselineEvidence(binding, height, hash) {
  if (binding?.model !== "proof-indexer-pwt-range-replay-verifier-binding-v1" ||
      binding.network !== "livenet" || binding.rangeReplayFromHeight !== 958383 ||
      binding.bindingId !== PIN.bindingId || binding.witnessSetHash !== PIN.witnessSetHash ||
      binding.witnessCount !== 18 || binding.witnessPreserveCount !== 10 ||
      binding.witnessedThroughBlock !== 968345 ||
      binding.witnessedThroughBlockHash !== "00000000000000000000b56a54d88f947645b2d5bf8a164a6d0b98b4ff24d4c6" ||
      !checkpointMatches(height, hash)) return null;
  return {model: INCB_REPLAY_BASELINE_MODEL, ...PIN, checkpointHeight: height, checkpointHash: hash};
}
export function reviewedIncbReplayBaselineFromEvidence(evidence, height, hash) {
  if (!evidence || evidence.model !== INCB_REPLAY_BASELINE_MODEL ||
      !checkpointMatches(height, hash) || evidence.checkpointHeight !== height ||
      evidence.checkpointHash !== hash ||
      Object.entries(PIN).some(([key,value]) => evidence[key] !== value) ||
      Object.keys(evidence).length !== Object.keys(PIN).length + 3) return null;
  return REVIEWED_INCB_REPLAY_BASELINE;
}
