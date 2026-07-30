import { createHash } from "node:crypto";
import {
  WORK_AMO_V6_ALLOWED_FACE_PROOFS,
  WORK_AMO_V6_AMOUNT_MODEL,
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V6_BOND_TRANSITION_MODEL,
  WORK_AMO_V6_STATE_ORDER_MODEL,
  WORK_AMO_V6_UNIT_MODEL,
  WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL,
} from "./work-amo-v6.mjs";
import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
} from "./work-amo-v5.mjs";
export function buildWorkAmoV6DeclarationText() {
  const declaration = [
    "ProofOfWork.Me WORK AMO Unit Protocol V6 Corrective Declaration",
    "network=livenet",
    "app=amo.proofofwork.me",
    `authorizationVersion=${WORK_AMO_V6_AUTH_VERSION}`,
    `declarationAuthorityScriptPubKey=${WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY}`,
    `declarationRegistryAddress=${WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS}`,
    `declarationMinimumRegistryPaymentProofs=${WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS}`,
    "declarationEvidenceRule=this declaration is valid only when its transaction is confirmed and canonical, input zero spends the declared authority scriptPubKey, the pinned registry output pays at least the declared minimum to the declared registry, and the pinned protocol output and record contain this exact declaration text",
    "activation=the first confirmed block after this declaration transaction",
    "newListingRule=from activation, new WORK listings are valid only under pwt-sale-v6; new V4/V5 listings are invalid",
    "legacySettlementRule=valid confirmed pre-activation V4/V5 listings keep their frozen confirmed terms and may still be sealed, purchased, or delisted without repricing",
    `allowedFaceProofs=${WORK_AMO_V6_ALLOWED_FACE_PROOFS.join(",")}`,
    `unitModel=${WORK_AMO_V6_UNIT_MODEL}`,
    `stateOrderModel=${WORK_AMO_V6_STATE_ORDER_MODEL}`,
    `amountModel=${WORK_AMO_V6_AMOUNT_MODEL}`,
    `bondTransitionModel=${WORK_AMO_V6_BOND_TRANSITION_MODEL}`,
    `blockSequencerModel=${WORK_AMO_V6_BLOCK_SEQUENCER_MODEL}`,
    `workOracleModel=${WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL}`,
    "positionOrder=confirmed block height, then transaction index in that block, then protocol output index, then record ordinal",
    "arithmeticOrder=integer multiplication and division only; multiplication before division; floor and ceiling are applied only where explicitly declared",
    "unitFormulaDefinitions=F=face proofs; N=networkValueBeforeQ8; S=21000000 WORK; A=10000000000000000 atoms per WORK; Q=100000000",
    "unitFormula=unitPriceProofs=F;unitAmountAtoms=floor(F*S*A*Q/N);unitMinimumPriceProofs=ceil(unitAmountAtoms*N/(S*A*Q))",
    "unitBounds=F must be an allowed positive integer; N must be positive; unitAmountAtoms must be between 1 and S*A inclusive; unitMinimumPriceProofs must be positive and no greater than F",
    "confirmationRule=the proof face is authorized before broadcast; the exact amount, price, minimum, N-before, listing position, and bond transition are derived and frozen only at confirmed canonical position",
    "computeThenBondRule=derive listing terms from N-before after every earlier canonical protocol event; after successful validation add this listing record's distinct registry-payment contribution to its record-level N-after; apply each transaction's miner-fee contribution exactly once after all protocol records in that transaction and before the next transaction",
    "settlementRule=a confirmed listing may be sealed or purchased using its frozen terms; settlement never selects a current value and never reprices",
    "failureRule=missing declaration, disallowed face, nonpositive N-before, zero or over-supply derived amount, derived field in the signed listing authorization, insufficient WORK, or arithmetic mismatch makes the new listing invalid",
    "historyRule=V5 pwa1 quote records and all earlier marketplace records remain immutable replayable history but do not govern V6 listing creation",
    "implementationRule=the open-source ProofOfWork.Me computer enforces these rules from canonical proof state; no external price feed or recurring on-chain price publication is required",
  ].join("\n");
  return declaration;
}

export function workAmoV6DeclarationCommitment() {
  const text = buildWorkAmoV6DeclarationText();
  const protocolRecord = `pwm1:m:${text}`;
  return Object.freeze({
    payloadBytes: Buffer.byteLength(text, "utf8"),
    payloadSha256: createHash("sha256")
      .update(Buffer.from(text, "utf8"))
      .digest("hex"),
    protocolRecord,
    protocolRecordBytes: Buffer.byteLength(
      protocolRecord,
      "utf8",
    ),
    protocolRecordSha256: createHash("sha256")
      .update(Buffer.from(protocolRecord, "utf8"))
      .digest("hex"),
    text,
  });
}
