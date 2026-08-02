import { createHash } from "node:crypto";

import {
  canonicalProtocolCandidateFromOutput,
} from "./canonical-op-return.mjs";
import {
  WORK_AMO_V8_ALLOWED_FACE_PROOFS,
  WORK_AMO_V8_AMOUNT_MODEL,
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_BOND_TRANSITION_MODEL,
  WORK_AMO_V8_DECIMALS,
  WORK_AMO_V8_GLOBAL_PRECISION_MODEL,
  WORK_AMO_V8_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V8_PRECISION_MIGRATION_MODEL,
  WORK_AMO_V8_PRECISION_MODEL,
  WORK_AMO_V8_STATE_ORDER_MODEL,
  WORK_AMO_V8_SUBATOMS_PER_WORK,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  WORK_AMO_V8_TRANSFER_VERSION,
  WORK_AMO_V8_UNIT_MODEL,
  WORK_AMO_V8_UNIT_WORK_ORACLE_MODEL,
} from "./work-amo-v8.mjs";
import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
} from "./work-amo-v5.mjs";
import {
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_TOKEN_ID,
} from "./work-units.mjs";

export function buildWorkAmoV8DeclarationText() {
  return [
    "ProofOfWork.Me WORK Precision Protocol V2 and AMO Unit Protocol V8 Declaration",
    "network=livenet",
    "app=amo.proofofwork.me",
    `tokenId=${WORK_TOKEN_ID}`,
    `authorizationVersion=${WORK_AMO_V8_AUTH_VERSION}`,
    `transferVersion=${WORK_AMO_V8_TRANSFER_VERSION}`,
    `globalPrecisionModel=${WORK_AMO_V8_GLOBAL_PRECISION_MODEL}`,
    `precisionMigrationModel=${WORK_AMO_V8_PRECISION_MIGRATION_MODEL}`,
    `amountStorageModel=${WORK_AMO_V8_PRECISION_MODEL}`,
    `tokenStateModel=${WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL}`,
    `workDecimals=${WORK_AMO_V8_DECIMALS}`,
    `subatomsPerWork=${WORK_AMO_V8_SUBATOMS_PER_WORK}`,
    `maxSupplySubatoms=${WORK_AMO_V8_MAX_SUPPLY_SUBATOMS}`,
    `mintAmountSubatoms=${WORK_AMO_V8_MINT_AMOUNT_SUBATOMS}`,
    `legacyAtomToSubatomScale=${WORK_SUBATOM_CONVERSION_FACTOR}`,
    "unitIdentity=one historical atom is exactly 0.00000001 WORK and converts to exactly 100000000 subatoms; one subatom is exactly 0.0000000000000001 WORK",
    `allowedFaceProofs=${WORK_AMO_V8_ALLOWED_FACE_PROOFS.join(",")}`,
    `unitModel=${WORK_AMO_V8_UNIT_MODEL}`,
    `stateOrderModel=${WORK_AMO_V8_STATE_ORDER_MODEL}`,
    `amountModel=${WORK_AMO_V8_AMOUNT_MODEL}`,
    `bondTransitionModel=${WORK_AMO_V8_BOND_TRANSITION_MODEL}`,
    `blockSequencerModel=${WORK_AMO_V8_BLOCK_SEQUENCER_MODEL}`,
    `workOracleModel=${WORK_AMO_V8_UNIT_WORK_ORACLE_MODEL}`,
    `declarationAuthorityScriptPubKey=${WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY}`,
    `declarationRegistryAddress=${WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS}`,
    `declarationMinimumRegistryPaymentProofs=${WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS}`,
    "declarationEvidenceRule=this declaration is valid only when its transaction is confirmed and canonical, input zero spends the declared authority scriptPubKey, the pinned registry output pays at least the declared minimum to the declared registry, and the pinned protocol output and record contain this exact declaration text",
    "declarationSelectionRule=the earliest exact valid declaration transaction by confirmed block height then transaction index is authoritative; its exact carrier and qualifying registry payment outputs must each be unambiguous, and a later duplicate cannot move activation",
    "activation=the first confirmed block after this declaration transaction",
    "precisionRule=from activation, canonical current WORK maximum supply, mint increment, supply, balances, transfers, reservations, and listing amounts use exactly sixteen decimal places and canonical integer subatoms at 10000000000000000 subatoms per WORK; floating-point arithmetic, truncation to eight decimals, and magnitude-based scale inference are invalid",
    "precisionMigrationRule=at the activation opening boundary, each confirmed canonical current eight-decimal WORK atom becomes exactly 100000000 sixteen-decimal subatoms by integer multiplication; maximum supply, mint increment, supply, and every holder balance conserve exactly under that mapping; raw confirmed history is not rewritten",
    "transferRule=from activation, a new current-state WORK transfer is valid only as pwt1:send3:<token-id>:<amount-subatoms>:<recipient>; historical send and send2 bytes remain replayable evidence but cannot create a post-activation mutation",
    "newListingRule=from activation, a new WORK listing is valid only under pwt-sale-v8, must authorize the single face 25000 proofs, and freezes unitAmountSubatoms at its confirmed canonical position; every other face or authorization version is invalid for a new WORK listing mutation",
    "positionOrder=confirmed block height, then transaction index in that block, then protocol output index, then record ordinal",
    "arithmeticOrder=integer multiplication and division only; multiplication before division; floor and ceiling are applied only where explicitly declared",
    "unitFormulaDefinitions=F=25000 proof face; N=networkValueBeforeQ8; S=21000000 WORK; A=10000000000000000 subatoms per WORK; Q=100000000",
    "unitFormula=unitPriceSats=F;unitAmountSubatoms=floor(F*S*A*Q/N);unitMinimumPriceSats=ceil(unitAmountSubatoms*N/(S*A*Q))",
    "unitBounds=F must equal the positive integer 25000; N must be positive; unitAmountSubatoms must be between 1 and S*A inclusive; unitMinimumPriceSats must be positive and no greater than F",
    "confirmationRule=the 25000-proof face is authorized before broadcast; the exact subatom amount, price, minimum, N-before, listing position, and bond transition are derived and frozen only at confirmed canonical position",
    "computeThenBondRule=derive listing terms from N-before after every earlier canonical protocol event; after successful validation add this listing record's distinct registry-payment contribution to its record-level N-after; apply each transaction's miner-fee contribution exactly once after all protocol records in that transaction and before the next transaction",
    "networkValuePrecisionRule=network value remains exact Q8 integer proof accounting at Q=100000000; Q8 network-value precision is independent from Q16 WORK quantity precision",
    "settlementRule=a confirmed V8 listing may be sealed or purchased only with its frozen terms; settlement never selects a current value and never reprices",
    "readinessFailureRule=declaration-evidence mismatch, incomplete precision migration or replay, exact-tip disagreement, scale mismatch, conservation failure, or disabled protocol writes pauses official preparation and broadcast admission; no legacy precision or listing protocol is re-enabled after activation",
    "validationFailureRule=a face other than 25000, nonpositive N-before, zero or over-supply derived amount, derived field in the signed authorization, insufficient WORK subatoms, noncanonical integer, wrong-era wire record, or arithmetic mismatch makes the new mutation invalid",
    "implementationRule=the open-source ProofOfWork.Me computer enforces these exact rules from canonical ProofOfWork state; no external price feed or recurring on-chain price publication is required",
  ].join("\n");
}

export function workAmoV8DeclarationCommitment() {
  const text = buildWorkAmoV8DeclarationText();
  const protocolRecord = `pwm1:m:${text}`;
  return Object.freeze({
    payloadBytes: Buffer.byteLength(text, "utf8"),
    payloadSha256: createHash("sha256")
      .update(Buffer.from(text, "utf8"))
      .digest("hex"),
    protocolRecord,
    protocolRecordBytes: Buffer.byteLength(protocolRecord, "utf8"),
    protocolRecordSha256: createHash("sha256")
      .update(Buffer.from(protocolRecord, "utf8"))
      .digest("hex"),
    text,
  });
}

export function workAmoV8DeclarationCarrierEvidence(
  transaction,
  {
    commitment = workAmoV8DeclarationCommitment(),
    protocolVout,
    recordOrdinal,
  } = {},
) {
  if (
    !transaction ||
    typeof transaction !== "object" ||
    Array.isArray(transaction) ||
    !Array.isArray(transaction.vout) ||
    !commitment ||
    typeof commitment !== "object" ||
    typeof commitment.protocolRecord !== "string" ||
    !Number.isSafeInteger(protocolVout) ||
    protocolVout < 0 ||
    recordOrdinal !== 0
  ) {
    return null;
  }
  const exactCarriers = [];
  for (
    let candidateVout = 0;
    candidateVout < transaction.vout.length;
    candidateVout += 1
  ) {
    const candidate = canonicalProtocolCandidateFromOutput(
      transaction.vout[candidateVout],
    );
    if (
      candidate?.decodeValid === true &&
      candidate.prefix === "pwm1:" &&
      candidate.text === commitment.protocolRecord
    ) {
      exactCarriers.push({ candidate, protocolVout: candidateVout });
    }
  }
  if (
    exactCarriers.length !== 1 ||
    exactCarriers[0].protocolVout !== protocolVout
  ) {
    return null;
  }
  const { candidate } = exactCarriers[0];
  const protocolRecord = candidate.text;
  return Object.freeze({
    decodeValid: true,
    exactCarrierCount: exactCarriers.length,
    payloadBytes: Buffer.byteLength(protocolRecord, "utf8"),
    payloadSha256: createHash("sha256")
      .update(Buffer.from(protocolRecord, "utf8"))
      .digest("hex"),
    protocol: "pwm1",
    protocolRecord,
    protocolVout,
    recordOrdinal,
  });
}
