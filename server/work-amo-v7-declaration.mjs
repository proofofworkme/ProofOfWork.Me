import { createHash } from "node:crypto";
import {
  WORK_AMO_V7_ALLOWED_FACE_PROOFS,
  WORK_AMO_V7_AMOUNT_MODEL,
  WORK_AMO_V7_AUTH_VERSION,
  WORK_AMO_V7_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V7_BOND_TRANSITION_MODEL,
  WORK_AMO_V7_DECIMALS,
  WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
  WORK_AMO_V7_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V7_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V7_PRECISION_MIGRATION_MODEL,
  WORK_AMO_V7_PRECISION_MODEL,
  WORK_AMO_V7_STATE_ORDER_MODEL,
  WORK_AMO_V7_SUBATOMS_PER_WORK,
  WORK_AMO_V7_TRANSFER_VERSION,
  WORK_AMO_V7_UNIT_MODEL,
  WORK_AMO_V7_UNIT_WORK_ORACLE_MODEL,
} from "./work-amo-v7.mjs";
import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
} from "./work-amo-v5.mjs";
import {
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_TOKEN_ID,
} from "./work-units.mjs";

export function buildWorkAmoV7DeclarationText() {
  return [
    "ProofOfWork.Me WORK Precision Protocol V2 and AMO Unit Protocol V7 Declaration",
    "network=livenet",
    "app=amo.proofofwork.me",
    `tokenId=${WORK_TOKEN_ID}`,
    `authorizationVersion=${WORK_AMO_V7_AUTH_VERSION}`,
    `transferVersion=${WORK_AMO_V7_TRANSFER_VERSION}`,
    `globalPrecisionModel=${WORK_AMO_V7_GLOBAL_PRECISION_MODEL}`,
    `precisionMigrationModel=${WORK_AMO_V7_PRECISION_MIGRATION_MODEL}`,
    `amountStorageModel=${WORK_AMO_V7_PRECISION_MODEL}`,
    `workDecimals=${WORK_AMO_V7_DECIMALS}`,
    `subatomsPerWork=${WORK_AMO_V7_SUBATOMS_PER_WORK}`,
    `maxSupplySubatoms=${WORK_AMO_V7_MAX_SUPPLY_SUBATOMS}`,
    `mintAmountSubatoms=${WORK_AMO_V7_MINT_AMOUNT_SUBATOMS}`,
    `legacyAtomToSubatomScale=${WORK_SUBATOM_CONVERSION_FACTOR}`,
    "unitIdentity=one historical atom is 0.00000001 WORK and converts to exactly 100000000 subatoms; one subatom is 0.0000000000000001 WORK",
    `declarationAuthorityScriptPubKey=${WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY}`,
    `declarationRegistryAddress=${WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS}`,
    `declarationMinimumRegistryPaymentProofs=${WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS}`,
    "declarationEvidenceRule=this declaration is valid only when its transaction is confirmed and canonical, input zero spends the declared authority scriptPubKey, the pinned registry output pays at least the declared minimum to the declared registry, and the pinned protocol output and record contain this exact declaration text",
    "declarationSelectionRule=the earliest exact valid declaration transaction by confirmed block height then transaction index is authoritative; its exact carrier and qualifying registry payment outputs must each be unambiguous, and a later duplicate cannot move activation",
    "activation=the first confirmed block after this declaration transaction",
    "preActivationRule=until activation, confirmed V6 remains the live WORK AMO listing protocol and existing canonical WORK state remains denominated under its historical eight-decimal model",
    "precisionRule=from activation, canonical current WORK supply, balances, transfers, reservations, and new listing amounts use exactly sixteen decimal places and integer subatoms at 10000000000000000 subatoms per WORK; floating-point arithmetic and magnitude-based scale inference are invalid",
    "migrationRule=at the activation opening boundary, each confirmed canonical current eight-decimal WORK atom becomes exactly 100000000 sixteen-decimal subatoms by integer multiplication; token-definition maximum and mint increment, supply, every holder balance, and current listing reservation must conserve exactly under that mapping; volatile pending WORK event listing action and balance-delta projections are purged while noncanonical transaction envelopes remain raw recovery input, then current pending projections are rebuilt deterministically from one stable Core mempool under the active V7 rules with exact membership semantic transaction and balance parity",
    "historyIntegrityRule=raw confirmed record bytes, historical send and send2 amounts, V4 V5 and V6 authorizations, original frozen terms, pre-activation canonical event and state commitments, and pre-activation closed snapshots remain byte-for-byte historical evidence and are never rewritten or reinterpreted; provisional or wrong-era derived projections at D+1 or later are invalidated and deterministically replayed from canonical raw evidence",
    "transferRule=from activation, a new current-state WORK transfer is valid only as pwt1:send3:<token-id>:<amount-subatoms>:<recipient>; historical send and send2 events remain replayable evidence but cannot create a post-activation current-state mutation",
    "transferRegistryRule=each WORK transfer record requires exactly 546 proofs attributed to the WORK registry before that record; separate qualifying registry outputs remain valid; two or more same-era WORK transfer records may instead use one singular aggregate registry output only when it precedes every funded transfer, equals exactly 546 multiplied by the funded record count, every pwt1 record in the transaction is one of those funded WORK transfers, and every other protocol record is only an earlier pwm1 mail envelope; the aggregate output is claimed once and contributes exactly 546 proofs per transfer",
    "mintRule=the WORK mint wire record remains pwt1:mint:<token-id>:1000; before activation it credits exactly 100000000000 historical atoms and from activation it credits exactly 10000000000000000000 subatoms; every other WORK mint amount is invalid and raw historical mint records are never rewritten",
    "newListingRule=from activation, new WORK listings are valid only under pwt-sale-v7 with unitAmountSubatoms derived at confirmed canonical position; every other authorization version is invalid for a new WORK listing mutation",
    "legacySettlementRule=valid confirmed pre-activation V4 V5 and V6 listings keep their original frozen terms and may still be sealed, purchased, or delisted without repricing; their current reservation is the exact legacy amount multiplied by 100000000 subatoms",
    `allowedFaceProofs=${WORK_AMO_V7_ALLOWED_FACE_PROOFS.join(",")}`,
    `unitModel=${WORK_AMO_V7_UNIT_MODEL}`,
    `stateOrderModel=${WORK_AMO_V7_STATE_ORDER_MODEL}`,
    `amountModel=${WORK_AMO_V7_AMOUNT_MODEL}`,
    `bondTransitionModel=${WORK_AMO_V7_BOND_TRANSITION_MODEL}`,
    `blockSequencerModel=${WORK_AMO_V7_BLOCK_SEQUENCER_MODEL}`,
    `workOracleModel=${WORK_AMO_V7_UNIT_WORK_ORACLE_MODEL}`,
    "positionOrder=confirmed block height, then transaction index in that block, then protocol output index, then record ordinal",
    "arithmeticOrder=integer multiplication and division only; multiplication before division; floor and ceiling are applied only where explicitly declared",
    "unitFormulaDefinitions=F=face proofs; N=networkValueBeforeQ8; S=21000000 WORK; A=10000000000000000 subatoms per WORK; Q=100000000",
    "unitFormula=unitPriceSats=F;unitAmountSubatoms=floor(F*S*A*Q/N);unitMinimumPriceSats=ceil(unitAmountSubatoms*N/(S*A*Q))",
    "unitFieldIdentity=the serialized integer fields unitPriceSats and unitMinimumPriceSats are denominated in proofs; proofs is display language and does not create alternate serialized unitPriceProofs or unitMinimumPriceProofs fields",
    "unitBounds=F must be one of 20000 50000 or 100000 positive integer proofs; N must be positive; unitAmountSubatoms must be between 1 and S*A inclusive; unitMinimumPriceSats must be positive and no greater than unitPriceSats F",
    "confirmationRule=the proof face is authorized before broadcast; the exact subatom amount, price, minimum, N-before, listing position, and bond transition are derived and frozen only at confirmed canonical position",
    "computeThenBondRule=derive listing terms from N-before after every earlier canonical protocol event; after successful validation add this listing record's distinct registry-payment contribution to its record-level N-after; apply each transaction's miner-fee contribution exactly once after all protocol records in that transaction and before the next transaction",
    "networkValuePrecisionRule=network value remains exact Q8 integer proof accounting at Q=100000000; Q8 network-value precision is independent from Q16 WORK quantity precision",
    "settlementRule=a confirmed listing may be sealed or purchased using its frozen terms; settlement never selects a current value and never reprices",
    "readinessFailureRule=once the canonical D+1 activation boundary is observed or persistently latched from the exact confirmed declaration, clearing omitting or malforming operator pins never re-enables legacy send send2 or a pre-V7 new-listing protocol; missing mismatched or reorged declaration evidence, incomplete precision migration or replay, exact-tip disagreement, scale mismatch, or conservation failure pauses official preparation and broadcast admission for every new WORK mint transfer listing seal or purchase; delisting an existing canonical listing remains permitted and canonical replay resumes only after exact readiness is restored",
    "validationFailureRule=a disallowed face, nonpositive N-before, zero or over-supply derived amount, derived field in the signed listing authorization, insufficient WORK subatoms, noncanonical integer, wrong-era wire record, or arithmetic mismatch makes the new mutation invalid",
    "implementationRule=the open-source ProofOfWork.Me computer enforces these rules from canonical ProofOfWork state; no external price feed or recurring on-chain price publication is required",
  ].join("\n");
}

export function workAmoV7DeclarationCommitment() {
  const text = buildWorkAmoV7DeclarationText();
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
