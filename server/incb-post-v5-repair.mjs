// A bounded repair witness for the two post-V5 INCB bonds whose synthetic
// mints were persisted as generic reserved-namespace faults. This module
// does not authorize any other transaction or change the completed PWT replay.
export const POST_V5_INCB_ISSUANCE_REPAIR_TARGETS = Object.freeze([
  Object.freeze({
    txid: "b00b9451bded7d2b7d339556ad2dc5d375e5b52ad877a1d3e2b29149dfc72ccf",
    blockHash: "0000000000000000000105b1f0900f90b86360b2b1a98897b9e429a1a67726f2",
    blockHeight: 963782,
    blockIndex: 2290,
    previousBlockHash: "0000000000000000000125cb7a4ec1acf7be628e927f8d42fe277969c61d02a9",
    workNetworkValueQ8: "740312837488337373524998649",
    attachedWorkSubatoms: "10000000000000000",
    attachedWorkValueQ8: "35252992261349398739",
    issuanceUnits: "352529923159",
    fixedValueQ8: "35252992315949398739",
  }),
  Object.freeze({
    txid: "ebe60fd108e8830b4741101e6525081387dcf328e81c12fa2b533de0bdbf0d3e",
    blockHash: "0000000000000000000069c13457832a58fd579fe3d654ce239a5a5a8b54400f",
    blockHeight: 968125,
    blockIndex: 2041,
    previousBlockHash: "000000000000000000011837b393ac8b60920238da37902390ad8629e76002f6",
    workNetworkValueQ8: "840950469793071163780428513",
    attachedWorkSubatoms: "18000000000000000000000",
    attachedWorkValueQ8: "72081468839406099752608158",
    issuanceUnits: "720814688394061543",
    fixedValueQ8: "72081468839406154352608158",
  }),
]);

const exactInteger = (value, label, positive = false) => {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text) || (positive && text === "0")) {
    throw new Error(`Post-V5 INCB repair ${label} is not an exact ${positive ? "positive" : "non-negative"} integer.`);
  }
  return BigInt(text);
};
const address = (value) => String(value ?? "").trim();
const hash = (value) => String(value ?? "").trim().toLowerCase();

export function validatePostV5IncbRepairProjection({
  bond,
  mint,
  previousBlockHash,
  recipient,
  target,
  tokenId,
  workTransfers,
}) {
  const fail = (reason) => { throw new Error(`Post-V5 INCB repair ${target?.txid ?? "target"}: ${reason}.`); };
  const knownTarget = POST_V5_INCB_ISSUANCE_REPAIR_TARGETS.find((known) =>
    known.txid === target?.txid && known.blockHash === target?.blockHash &&
    known.blockHeight === target?.blockHeight && known.blockIndex === target?.blockIndex);
  if (!knownTarget) fail("target is not in the exact approved repair set");
  if (hash(previousBlockHash) !== knownTarget.previousBlockHash) {
    fail("previous block hash differs from the pinned Core predecessor");
  }
  for (const [label, item] of [["bond", bond], ["mint", mint]]) {
    if (hash(item?.txid) !== target.txid || hash(item?.blockHash) !== target.blockHash ||
        Number(item?.blockHeight) !== target.blockHeight || Number(item?.blockIndex) !== target.blockIndex ||
        item?.confirmed !== true || item?.valid === false) {
      fail(`${label} does not match its confirmed Core position`);
    }
  }
  if (bond?.kind !== "inception-bond" || bond?.protocol !== "pwm1") fail("parent is not a canonical Inception Bond");
  if (mint?.kind !== "token-mint" || mint?.protocol !== "pwt1" ||
      hash(mint?.tokenId) !== tokenId || hash(mint?.sourceBondTxid) !== target.txid ||
      mint?.sourceKind !== "inception-bond" || mint?.validationMode !== "canonical-incb-bond-projection" ||
      Number(mint?.protocolVout) !== Number(bond?.protocolVout) ||
      Number(mint?.recordOrdinal) !== 1 ||
      exactInteger(mint?.amountSats, "mint carrier value") !== 0n) {
    fail("mint is not the zero-value synthetic projection of this bond");
  }
  const recipientAddress = address(recipient?.address);
  const recipientVout = Number(recipient?.vout);
  const direct = exactInteger(recipient?.amountSats, "direct bond payment", true);
  if (!recipientAddress || !Number.isSafeInteger(recipientVout) || recipientVout < 0 ||
      address(mint?.minterAddress) !== recipientAddress ||
      address(mint?.bondRecipientAddress) !== recipientAddress ||
      Number(mint?.bondRecipientVout) !== recipientVout ||
      exactInteger(mint?.bondRecipientAmountSats, "mint recipient payment", true) !== direct ||
      exactInteger(mint?.directProofIssuanceUnits, "direct issuance", true) !== direct) {
    fail("mint recipient or direct issuance disagrees with Core payment");
  }
  if (Number(mint?.issuanceValueSnapshotBlockHeight) !== target.blockHeight - 1 ||
      hash(mint?.issuanceValueSnapshotBlockHash) !== hash(previousBlockHash) ||
      hash(mint?.issuanceCheckpointBlockHash) !== target.blockHash ||
      Number(mint?.issuanceCheckpointBlockHeight) !== target.blockHeight ||
      Number(mint?.issuanceCheckpointBlockIndex) !== target.blockIndex) {
    fail("H-1 value or bond position is not hash-bound to Core");
  }
  const transfers = Array.isArray(workTransfers) ? workTransfers : [];
  if (transfers.length !== 1) fail("expected exactly one accepted same-transaction WORK transfer");
  const [transfer] = transfers;
  const attachedSubatoms = exactInteger(mint?.attachedWorkAmountSubatoms, "attached WORK subatoms", true);
  if (hash(transfer?.txid) !== target.txid || hash(transfer?.blockHash) !== target.blockHash ||
      Number(transfer?.blockHeight) !== target.blockHeight || Number(transfer?.blockIndex) !== target.blockIndex ||
      transfer?.kind !== "token-transfer" || transfer?.confirmed !== true || transfer?.valid === false ||
      address(transfer?.recipientAddress) !== recipientAddress ||
      exactInteger(transfer?.amountSubatoms, "accepted WORK subatoms", true) !== attachedSubatoms) {
    fail("accepted WORK companion does not match the bond recipient and exact Q16 amount");
  }
  const liveQ8 = exactInteger(mint?.attachedWorkLiveValueAtSendQ8, "attached WORK value Q8", true);
  const directQ8 = direct * 100_000_000n;
  const units = direct + liveQ8 / 100_000_000n;
  const dustQ8 = liveQ8 % 100_000_000n;
  if (exactInteger(mint?.attachedWorkIssuanceUnits, "attached issuance") !== liveQ8 / 100_000_000n ||
      exactInteger(mint?.confirmedIssuanceUnits, "confirmed issuance", true) !== units ||
      exactInteger(mint?.amount, "mint amount", true) !== units ||
      exactInteger(mint?.issuanceNetworkValueQ8, "fixed issuance value Q8", true) !== directQ8 + liveQ8 ||
      exactInteger(mint?.issuanceDustQ8, "issuance dust Q8") !== dustQ8) {
    fail("issued units and fixed value do not conserve exact Q8");
  }
  if (exactInteger(mint?.issuanceValueSnapshotWorkNetworkValueQ8, "H-1 WORK network value Q8", true).toString() !== knownTarget.workNetworkValueQ8 ||
      attachedSubatoms.toString() !== knownTarget.attachedWorkSubatoms ||
      liveQ8.toString() !== knownTarget.attachedWorkValueQ8 ||
      units.toString() !== knownTarget.issuanceUnits ||
      (directQ8 + liveQ8).toString() !== knownTarget.fixedValueQ8) {
    fail("rederived issuance differs from the independent pinned Core and WORK transition evidence");
  }
  return Object.freeze({
    amount: units.toString(),
    attachedWorkSubatoms: attachedSubatoms.toString(),
    directProofSats: direct.toString(),
    fixedValueQ8: (directQ8 + liveQ8).toString(),
    previousBlockHash: hash(previousBlockHash),
    recipientAddress,
    recipientVout,
    txid: target.txid,
  });
}
