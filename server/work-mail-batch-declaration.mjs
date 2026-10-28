import { createHash } from "node:crypto";
import { address, networks } from "bitcoinjs-lib";
import { canonicalProtocolCandidateFromOutput } from "./canonical-op-return.mjs";
import {
  WORK_MAIL_BATCH_ACTION,
  WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES,
  WORK_MAIL_BATCH_MAX_RECIPIENTS,
  WORK_MAIL_BATCH_MAX_SUBATOMS,
  WORK_MAIL_BATCH_MIN_RECIPIENTS,
  WORK_MAIL_BATCH_MOVEMENT_MODEL,
  WORK_MAIL_BATCH_REGISTRY_ADDRESS,
  WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS,
  WORK_MAIL_BATCH_SUBATOMS_PER_WORK,
  WORK_MAIL_BATCH_TOKEN_ID,
} from "../src/shared/protocol/workMailBatch.mjs";

export const WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT = 973283;

export const WORK_MAIL_BATCH_DECLARATION_EVIDENCE_MODEL = "canonical-work-mail-batch-v1-declaration-evidence-v1";
export const WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL = "canonical-work-mail-batch-v1-authority-commitment-v1";
export const WORK_MAIL_BATCH_DECLARATION_AUTHORITY_ADDRESS = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
export const WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY = "76a91499b91dd27a616a71c0a1e9db6a86ceb8cff284c588ac";
export const WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS = WORK_MAIL_BATCH_REGISTRY_ADDRESS;
export const WORK_MAIL_BATCH_DECLARATION_MIN_PAYMENT_SATS = WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS;
// No deployment, environment switch or local fixture establishes declaration
// authority. Real pins are recorded only after independent chain verification.
export const WORK_MAIL_BATCH_DECLARATION_PINS = Object.freeze({
  txid: "", blockHeight: 0, blockHash: "", blockTransactionIndex: 0,
  protocolVout: 0, recordOrdinal: 0, registryPaymentVout: 0, activationHeight: 0,
});

const HASH = /^[0-9a-f]{64}$/u;
const REGISTRY_SCRIPT = Buffer.from(address.toOutputScript(WORK_MAIL_BATCH_REGISTRY_ADDRESS, networks.bitcoin)).toString("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const invalid = (reasonCode) => ({ valid: false, reasonCode });

export function buildWorkMailBatchDeclarationText() {
  return [
    "ProofOfWork.Me WORK Mail Attachment Protocol V1 Declaration",
    "network=livenet",
    "app=mail.proofofwork.me,computer.proofofwork.me",
    `tokenId=${WORK_MAIL_BATCH_TOKEN_ID}`,
    `transferVersion=${WORK_MAIL_BATCH_ACTION}`,
    `registryAddress=${WORK_MAIL_BATCH_REGISTRY_ADDRESS}`,
    `registryPaymentProofs=${WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS}`,
    `workSubatomsPerWork=${WORK_MAIL_BATCH_SUBATOMS_PER_WORK}`,
    `maxSupplySubatoms=${WORK_MAIL_BATCH_MAX_SUBATOMS}`,
    `minimumRecipients=${WORK_MAIL_BATCH_MIN_RECIPIENTS}`,
    `maximumRecipients=${WORK_MAIL_BATCH_MAX_RECIPIENTS}`,
    `maximumProtocolPayloadUtf8Bytes=${WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES}`,
    `movementValueModel=${WORK_MAIL_BATCH_MOVEMENT_MODEL}`,
    `declarationAuthorityAddress=${WORK_MAIL_BATCH_DECLARATION_AUTHORITY_ADDRESS}`,
    `declarationAuthorityScriptPubKey=${WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY}`,
    `declarationRegistryAddress=${WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS}`,
    `minimumDeclarationBlockHeight=${WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT}`,
    `declarationMinimumRegistryPaymentProofs=${WORK_MAIL_BATCH_DECLARATION_MIN_PAYMENT_SATS}`,
    "declarationEvidenceRule=the exact declaration is confirmed and canonical; input zero spends the declared authority script; exactly one qualifying registry output pays at least the declared minimum before or after the unique exact declaration carrier; ordinary Mail recipients and legacy WORK signal attachments are permitted; exact transaction, block height, block hash, transaction index, registry output index, protocol output index and record ordinal are pinned",
    "declarationSelectionRule=the earliest exact valid declaration at or after minimumDeclarationBlockHeight by confirmed block height then transaction index is authoritative; later duplicate declarations cannot move activation",
    "activation=the opening of the first confirmed block after this declaration transaction; activationHeight equals declarationHeight plus one",
    "additiveEraRule=mailbatch1 is additive to activated WORK Q16 and standalone batch1 and does not change batch1 or send3, its per-transfer registry fee, historical wire bytes, existing balances, supply, reservations, listings, frozen terms or bond issuance",
    "wireFormat=pwt1:mailbatch1:<canonical-work-token-id>:<canonical-unpadded-base64url-of-UTF8-JSON>",
    "wireJsonRule=the JSON is exactly an ordered array of two-item arrays [[recipientAddress,positiveQ16SubatomsString],...]; no whitespace, alternate escapes, extra members or alternate encodings are valid; addresses are checksum-valid on livenet, Bech32 is lowercase and Base58 case is exact; recipient addresses are distinct",
    "quantityRule=each amount is a canonical positive base-ten integer string with no leading zero; each amount and the exact sum are at most maxSupplySubatoms; floating-point, exponent, signed and decimal wire quantities are invalid",
    "carrierRule=the transaction contains exactly one complete contiguous ordinary PWM Mail, reply or file envelope containing only m/s/r/a parts, at least one body part, at most one subject and one reply part, and a complete file when attached, followed by exactly one zero-valued mailbatch1 OP_RETURN carrier; every Mail carrier is zero-valued; no other governed protocol or malformed carrier is allowed; the aggregate 100000-byte OP_RETURN script ceiling remains; the WORK payload has at most maximumProtocolPayloadUtf8Bytes bytes",
    "authorityRule=every input resolves to the same sender; supported canonical raw spend evidence verifies the transaction id, prevout scripts and values, public-key/script bindings and every input signature committing all inputs and outputs with SIGHASH_ALL or Taproot SIGHASH_DEFAULT; ANYONECANPAY, unknown prevouts, mixed authors and unsupported or unverifiable authority fail closed",
    "paymentRule=outputs are ordered as one positive ordinary Mail proof payment per distinct WORK recipient in the same vector order, then the complete PWM envelope, then one dedicated WORK registry output of exactly 546 proofs, then the mailbatch1 carrier, then optional positive sender change; a Mail recipient may itself be the WORK registry; the dedicated registry payment is identified by its position after the complete envelope and belongs to the WORK batch once; ordinary Mail proof payments and miner fee remain separate",
    "balanceRule=the sender's confirmed available balance at the batch opening after all existing reservations must cover the entire declared sum, including a self-recipient; validate every recipient, quantity, authority, payment and capacity before changing any balance; debit the sum once and credit every recipient once atomically",
    "atomicityRule=all WORK attachment recipients apply or none apply; ordinary Mail remains independently valid when its WORK attachment fails; an invalid entry, duplicate address, unavailable evidence, over-supply sum, insufficient capacity or conflicting carrier invalidates the whole batch; pending observations cannot change confirmed balances",
    "positionOrder=confirmed block height, transaction index, protocol output index, record ordinal; all recipient rows are projections of one accepted batch position and are not separately ordered protocol actions",
    "movementRule=let A be the sum of non-self recipient subatoms and N the exact Q8 network value immediately before the batch; frozenMovementValueQ8=floor(A*N/maxSupplySubatoms); multiply before dividing and round down once for the aggregate; recipient ordering never reprices another recipient",
    "selfTransferRule=self-recipient subatoms conserve the sender's balance and contribute zero WORK movement value; they still consume opening spendable capacity during validation",
    "accountingRule=after atomic validation add the aggregate frozen WORK movement and the one 546-proof registry payment once; apply the transaction miner fee once under the existing transaction-final fee rule; derived recipient history rows own no payment, miner fee, separate economic output or second movement value",
    "liveValueRule=the existing canonical live WORK accounting may revalue the aggregate non-self movement using its existing live floor rules; the frozen opening-state value and all recipient amounts remain immutable",
    "associationRule=mailbatch1 supplies only the ordinary Mail envelope in the same transaction; its complete ordered unique WORK vector must exactly match the ordinary Mail proof-payment recipients; it cannot supply a Boost tip, Jobs payment or bond attachment; legacy send3 Mail and standalone batch1 history remain unchanged",
    "readinessRule=unconfigured pins, missing exact declaration evidence, incomplete replay or projection parity, disagreement with the canonical Q16 state or exact current tip fail official preparation and broadcast closed; an explicit independent batch write gate is additionally required; disabled writes never erase valid confirmed batch history",
    "implementationRule=the open-source ProofOfWork.Me Computer verifies this additive rule from confirmed chain records; local fixtures, deployment, pending records and disabled gates are not activation authority",
  ].join("\n");
}

export function workMailBatchDeclarationCommitment() {
  const text = buildWorkMailBatchDeclarationText();
  const protocolRecord = `pwm1:m:${text}`;
  return Object.freeze({
    text, protocolRecord,
    payloadBytes: Buffer.byteLength(text, "utf8"), payloadSha256: hash(Buffer.from(text, "utf8")),
    protocolRecordBytes: Buffer.byteLength(protocolRecord, "utf8"),
    protocolRecordSha256: hash(Buffer.from(protocolRecord, "utf8")),
  });
}

export function workMailBatchDeclarationPaymentOrderValid(value) {
  if (!value || !integer(value.registryPaymentVout) || !integer(value.protocolVout) ||
      value.recordOrdinal !== 0) return false;
  return value.registryPaymentVout !== value.protocolVout;
}

export function normalizeWorkMailBatchDeclarationPins(value = WORK_MAIL_BATCH_DECLARATION_PINS) {
  const commitment = workMailBatchDeclarationCommitment();
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !HASH.test(value.txid ?? "") || !HASH.test(value.blockHash ?? "") ||
      !integer(value.blockHeight, WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT) || !integer(value.blockTransactionIndex) ||
      !integer(value.protocolVout) || value.protocolVout > 0xffffffff ||
      value.recordOrdinal !== 0 || !integer(value.registryPaymentVout) ||
      !workMailBatchDeclarationPaymentOrderValid(value) ||
      !integer(value.activationHeight, 1) || value.activationHeight !== value.blockHeight + 1) return null;
  const fixed = {
    authorityScriptPubKey: WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
    registryAddress: WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS,
    minimumPaymentSats: WORK_MAIL_BATCH_DECLARATION_MIN_PAYMENT_SATS,
    payloadBytes: commitment.protocolRecordBytes,
    payloadSha256: commitment.protocolRecordSha256,
  };
  if (Object.keys(fixed).some((key) => value[key] !== undefined && value[key] !== fixed[key])) return null;
  return Object.freeze({
    txid: value.txid, blockHeight: value.blockHeight, blockHash: value.blockHash,
    blockTransactionIndex: value.blockTransactionIndex,
    protocolVout: value.protocolVout, recordOrdinal: value.recordOrdinal,
    registryPaymentVout: value.registryPaymentVout, activationHeight: value.activationHeight,
    ...fixed,
  });
}

export function workMailBatchDeclarationCarrierEvidence(transaction, { protocolVout, recordOrdinal } = {}) {
  const commitment = workMailBatchDeclarationCommitment();
  if (!Array.isArray(transaction?.vout) || !integer(protocolVout) || recordOrdinal !== 0) return null;
  const exact = transaction.vout.flatMap((output, vout) => {
    const candidate = canonicalProtocolCandidateFromOutput(output);
    return candidate?.decodeValid === true && candidate.text === commitment.protocolRecord ? [vout] : [];
  });
  if (exact.length !== 1 || exact[0] !== protocolVout) return null;
  return Object.freeze({
    decodeValid: true, exactCarrierCount: 1, protocol: "pwm1",
    protocolVout, recordOrdinal, protocolRecord: commitment.protocolRecord,
    payloadBytes: commitment.protocolRecordBytes, payloadSha256: commitment.protocolRecordSha256,
  });
}

function outputScript(output) {
  return String(output?.scriptpubkey ?? output?.scriptPubKey?.hex ?? output?.scriptPubKeyHex ?? "").toLowerCase();
}

function exactProofs(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return integer(value) ? BigInt(value) : null;
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}

/** Caller supplies canonical=true only after independently fencing Core's
 * block hash and transaction index. Hydration is not a substitute for that
 * fence; a public caller's declared status must never reach this boundary. */
export function workMailBatchDeclarationEvidenceFromTransaction(transaction, pins, { canonical = false } = {}) {
  const expected = normalizeWorkMailBatchDeclarationPins(pins);
  const unavailable = (reasonCode) => Object.freeze({
    model: WORK_MAIL_BATCH_DECLARATION_EVIDENCE_MODEL, confirmed: false, canonical: false,
    evidenceComplete: false, reasonCode,
  });
  if (!expected) return unavailable("work-mail-batch-declaration-commitment-unconfigured");
  const status = transaction?.status;
  const blockIndex = transaction?._powBlockIndex ?? status?.block_index ?? status?.block_tx_index;
  if (canonical !== true || transaction?._powCanonicalRpcHydration !== true ||
      transaction?.txid !== expected.txid || status?.confirmed !== true ||
      status?.block_height !== expected.blockHeight || status?.block_hash !== expected.blockHash ||
      blockIndex !== expected.blockTransactionIndex) {
    return unavailable("work-mail-batch-declaration-canonical-transaction-unavailable");
  }
  const carrier = workMailBatchDeclarationCarrierEvidence(transaction, expected);
  const authorityScript = outputScript(transaction?.vin?.[0]?.prevout);
  const payments = (transaction.vout ?? []).flatMap((output, vout) => {
    const value = exactProofs(output?.value);
    return outputScript(output) === REGISTRY_SCRIPT && value !== null &&
      value >= BigInt(WORK_MAIL_BATCH_DECLARATION_MIN_PAYMENT_SATS) ? [{ vout, value }] : [];
  });
  if (!carrier || authorityScript !== WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY ||
      payments.length !== 1 || payments[0].vout !== expected.registryPaymentVout) {
    return unavailable("work-mail-batch-declaration-transaction-evidence-mismatch");
  }
  return Object.freeze({
    ...expected, model: WORK_MAIL_BATCH_DECLARATION_EVIDENCE_MODEL,
    confirmed: true, canonical: true, evidenceComplete: true,
    registryPaymentSats: payments[0].value.toString(), carrier,
  });
}

export const workMailBatchDeclarationTransactionEvidence = workMailBatchDeclarationEvidenceFromTransaction;

export function validateWorkMailBatchDeclarationEvidence(evidence, { expectedDeclaration } = {}) {
  const expected = normalizeWorkMailBatchDeclarationPins(expectedDeclaration);
  if (!expected) return invalid("work-mail-batch-declaration-commitment-unconfigured");
  if (evidence?.model !== WORK_MAIL_BATCH_DECLARATION_EVIDENCE_MODEL ||
      evidence?.confirmed !== true || evidence?.canonical !== true || evidence?.evidenceComplete !== true) {
    return invalid("work-mail-batch-declaration-evidence-unavailable");
  }
  if (Object.keys(expected).some((key) => evidence[key] !== expected[key]) ||
      exactProofs(evidence.registryPaymentSats) === null ||
      exactProofs(evidence.registryPaymentSats) < BigInt(expected.minimumPaymentSats) ||
      evidence.carrier?.exactCarrierCount !== 1 || evidence.carrier?.decodeValid !== true ||
      evidence.carrier?.protocolVout !== expected.protocolVout ||
      evidence.carrier?.recordOrdinal !== expected.recordOrdinal ||
      evidence.carrier?.payloadBytes !== expected.payloadBytes ||
      evidence.carrier?.payloadSha256 !== expected.payloadSha256 ||
      evidence.carrier?.protocolRecord !== workMailBatchDeclarationCommitment().protocolRecord) {
    return invalid("work-mail-batch-declaration-evidence-mismatch");
  }
  const preimage = JSON.stringify({
    model: WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL,
    declaration: expected, registryPaymentSats: evidence.registryPaymentSats,
  });
  return Object.freeze({
    valid: true, activationHeight: expected.activationHeight, declaration: expected,
    evidenceCommitment: Object.freeze({
      model: WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL,
      payloadBytes: Buffer.byteLength(preimage, "utf8"), sha256: hash(Buffer.from(preimage, "utf8")),
    }),
  });
}

export function workMailBatchActivationFromEvidence(evidence, { expectedDeclaration, indexedThroughBlock } = {}) {
  const validation = validateWorkMailBatchDeclarationEvidence(evidence, { expectedDeclaration });
  if (!validation.valid) return Object.freeze({ active: false, reasonCode: validation.reasonCode });
  if (!integer(indexedThroughBlock, 1) || indexedThroughBlock < validation.activationHeight) {
    return Object.freeze({ active: false, activationHeight: validation.activationHeight,
      reasonCode: "work-mail-batch-activation-not-indexed" });
  }
  return Object.freeze({
    active: true, activationHeight: validation.activationHeight,
    declaration: validation.declaration, evidenceCommitment: validation.evidenceCommitment,
    canonical: true, confirmed: true, evidenceComplete: true,
  });
}

export function workMailBatchDeclarationStatus({ evidence, expectedDeclaration, indexedThroughBlock,
  writesEnabled = false, replayReady = false, exactTipReady = false } = {}) {
  const activation = workMailBatchActivationFromEvidence(evidence, { expectedDeclaration, indexedThroughBlock });
  const writesAllowed = activation.active && writesEnabled === true && replayReady === true && exactTipReady === true;
  return Object.freeze({
    ...activation, writesAllowed,
    reasonCode: activation.reasonCode ?? (writesEnabled !== true ? "work-mail-batch-writes-disabled" :
      replayReady !== true ? "work-mail-batch-replay-unavailable" :
      exactTipReady !== true ? "work-mail-batch-exact-tip-unavailable" : ""),
  });
}

export const WORK_MAIL_BATCH_ACTIVATION_META_KEY = "work-mail-batch-v1:activation:livenet";
export const WORK_MAIL_BATCH_ACTIVATION_MARKER_MODEL = "canonical-work-mail-batch-v1-activation-marker-v1";

function exactBatchEvidenceCommitment(value) {
  return value?.model === WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL &&
    integer(value.payloadBytes, 1) && HASH.test(value.sha256 ?? "");
}

export function validateWorkMailBatchActivationMarker(value) {
  const pins = normalizeWorkMailBatchDeclarationPins(value?.declaration);
  const activation = value?.activationBlock;
  const chain = activation?.transitionChainCommitment;
  if (!pins || value?.model !== WORK_MAIL_BATCH_ACTIVATION_MARKER_MODEL || value.network !== "livenet" ||
      value.activationHeight !== pins.activationHeight || !exactBatchEvidenceCommitment(value.evidenceCommitment) ||
      activation?.height !== pins.activationHeight || !HASH.test(activation?.hash ?? "") ||
      activation?.previousBlockHash !== pins.blockHash ||
      chain?.model !== "canonical-work-amo-raw-transition-chain-sha256-v1" ||
      !integer(chain?.payloadBytes, 1) || !HASH.test(chain?.sha256 ?? "")) {
    return invalid("work-mail-batch-activation-marker-invalid");
  }
  return { valid: true, marker: { model: WORK_MAIL_BATCH_ACTIVATION_MARKER_MODEL, network: "livenet",
    activationHeight: pins.activationHeight, declaration: pins,
    evidenceCommitment: { model: value.evidenceCommitment.model, payloadBytes: value.evidenceCommitment.payloadBytes, sha256: value.evidenceCommitment.sha256 },
    activationBlock: { height: activation.height, hash: activation.hash, previousBlockHash: activation.previousBlockHash,
      transitionChainCommitment: { model: chain.model, payloadBytes: chain.payloadBytes, sha256: chain.sha256 } },
  } };
}

export function workMailBatchActivationMarkerFromTransition(transition) {
  if (transition?.payload && typeof transition.payload === "object") {
    for (const key of ["blockHeight", "blockHash", "previousBlockHash"]) {
      if (transition[key] !== undefined && transition[key] !== transition.payload[key]) {
        throw new Error("WORK Mail batch activation transition wrapper conflicts with its committed descriptor.");
      }
    }
    transition = transition.payload;
  }
  const context = transition?.workMailBatchV1;
  if (!context) return null;
  const pins = normalizeWorkMailBatchDeclarationPins({ ...context.declaration, activationHeight: context.activationHeight });
  if (!pins || transition.network !== "livenet" || transition.complete !== true ||
      transition.blockAtomic !== true || transition.feeOnce !== true || transition.invalidZero !== true ||
      !integer(transition.blockHeight, pins.activationHeight) || !exactBatchEvidenceCommitment(context.evidenceCommitment)) {
    throw new Error("WORK Mail batch activation requires an exact complete canonical transition.");
  }
  if (transition.blockHeight > pins.activationHeight) return null;
  const result = validateWorkMailBatchActivationMarker({
    model: WORK_MAIL_BATCH_ACTIVATION_MARKER_MODEL, network: "livenet", declaration: pins,
    activationHeight: pins.activationHeight, evidenceCommitment: context.evidenceCommitment,
    activationBlock: { height: transition.blockHeight, hash: transition.blockHash,
      previousBlockHash: transition.previousBlockHash, transitionChainCommitment: transition.transitionChainCommitment },
  });
  if (!result.valid) throw new Error("WORK Mail batch activation transition cannot establish its persistent marker.");
  return result.marker;
}
