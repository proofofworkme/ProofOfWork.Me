import { WORK_TOKEN_ID } from "./work-units.mjs";
import { WORK_AMO_V5_INCB_TOKEN_ID, workAmoV5CanonicalPayloadCommitment } from "./work-amo-v5.mjs";

const integer = (value) => /^(0|[1-9][0-9]*)$/u.test(String(value ?? "")) ? BigInt(value) : null;
const positionKey = (value) => {
  const p = value?.position ?? value;
  return p && [p.blockHeight, p.blockTransactionIndex ?? p.blockIndex, p.protocolVout, p.recordOrdinal].join(":");
};
const equal = (a, b) => workAmoV5CanonicalPayloadCommitment(a).sha256 === workAmoV5CanonicalPayloadCommitment(b).sha256;

// Native replay preserves direct and WORK-attachment issuance as separate
// derived records. The application stores one canonical mint per recipient.
// Prove that exact fan-in without rewriting the native event set or issuing
// either component twice. This operates only on an already verified transition.
export function canonicalIncbReplayComponents(mint, records) {
  if (mint?.kind !== "token-mint" || mint?.tokenId !== WORK_AMO_V5_INCB_TOKEN_ID ||
      mint?.validationMode !== "canonical-incb-bond-projection") return null;
  const fail = () => { throw new Error("Canonical INCB replay components do not bind one exact recipient mint."); };
  if (mint.confirmed !== true || mint.valid === false || mint.protocol !== "pwt1" ||
      mint.sourceBondTxid !== mint.txid || !mint.minterAddress ||
      mint.bondRecipientAddress !== mint.minterAddress || integer(mint.amountSats) !== 0n) return fail();
  const candidates = records.filter((record) => record.txid === mint.txid &&
    record.protocol === "pwt1" && record.rawCandidate === false &&
    record.output?.projection?.kind === "token-mint" &&
    record.output.projection.tokenId === WORK_AMO_V5_INCB_TOKEN_ID &&
    record.output.projection.recipientAddress === mint.minterAddress);
  const direct = candidates.filter((record) => !record.output.projection.workSendPosition);
  const attachments = candidates.filter((record) => record.output.projection.workSendPosition);
  const primary = direct.find((record) => positionKey(record) === positionKey(mint));
  if (direct.length !== 1 || !primary || new Set(candidates.map(positionKey)).size !== candidates.length) return fail();
  let units = 0n, attachedUnits = 0n, attachedQ8 = 0n, subatoms = 0n;
  for (const record of candidates) {
    const p = record.output.projection;
    const witness = record.rawWitness;
    const parent = records.find((item) => item.txid === mint.txid && item.rawCandidate === true &&
      positionKey(item) === positionKey(witness?.parentPosition));
    const amount = integer(p.amount);
    if (amount === null || record.derived !== true || record.chargesTransactionFee !== false ||
        record.outcome?.valid !== true || record.position?.blockHash !== mint.blockHash ||
        record.position?.blockHeight !== mint.blockHeight ||
        record.position?.blockTransactionIndex !== mint.blockIndex ||
        witness?.model !== "canonical-work-amo-v5-derived-child-v1" ||
        !parent || parent.outcome?.valid !== true || parent.protocol !== witness.parentProtocol ||
        p.chargesTransactionFee !== false || p.claimsEconomicOutputs !== false || p.economicDelta !== false ||
        p.rawCandidate !== false || !p.derivedId || p.derivedId !== witness.descriptor?.derivedId ||
        positionKey(witness.descriptor.projectionPosition) !== positionKey(record) ||
        !equal(witness.descriptor, Object.fromEntries(Object.keys(witness.descriptor).map((key) => [key, p[key]])))) return fail();
    units += amount;
    if (record === primary) {
      if (parent.protocol !== "pwm1" || parent.output?.classification?.kind !== "inception-bond" ||
          p.recipientVout !== mint.bondRecipientVout || amount !== integer(mint.bondRecipientAmountSats) ||
          amount !== integer(mint.directProofIssuanceUnits)) return fail();
    } else {
      const value = integer(p.attachedWorkLiveValueAtSendQ8), quantity = integer(p.attachedWorkAmountSubatoms);
      if (parent.protocol !== "pwt1" || parent.output?.projection?.kind !== "token-transfer" ||
          parent.output.projection.tokenId !== WORK_TOKEN_ID ||
          parent.output.projection.recipientAddress !== mint.minterAddress ||
          integer(parent.output.projection.amountSubatoms) !== quantity ||
          positionKey(p.workSendPosition) !== positionKey(parent) ||
          positionKey(p.parentPosition) !== positionKey(primary.output.projection.parentPosition) ||
          !Array.isArray(p.matchedBondRecipientVouts) || p.matchedBondRecipientVouts.length !== 1 ||
          p.matchedBondRecipientVouts[0] !== mint.bondRecipientVout ||
          value === null || quantity === null || quantity <= 0n || amount !== value / 100000000n) return fail();
      attachedUnits += amount; attachedQ8 += value; subatoms += quantity;
    }
  }
  if (units !== integer(mint.amount) || units !== integer(mint.confirmedIssuanceUnits) ||
      attachedUnits !== integer(mint.attachedWorkIssuanceUnits) ||
      attachedQ8 !== integer(mint.attachedWorkLiveValueAtSendQ8) ||
      subatoms !== integer(mint.attachedWorkAmountSubatoms) ||
      integer(mint.issuanceNetworkValueQ8) !== integer(mint.directProofIssuanceUnits) * 100000000n + attachedQ8) return fail();
  return { primary, attachments, witness: candidates.map((record) => ({
    position: record.position, derivedId: record.output.projection.derivedId,
    rawWitnessSha256: workAmoV5CanonicalPayloadCommitment(record.rawWitness).sha256,
  })) };
}
