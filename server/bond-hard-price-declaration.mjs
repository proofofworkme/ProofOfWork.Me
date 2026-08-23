import { createHash } from "node:crypto";

import {
  canonicalProtocolCandidateFromOutput,
} from "./canonical-op-return.mjs";

export const BOND_HARD_PRICE_DECLARATION_EVIDENCE_MODEL =
  "canonical-bond-hard-price-declaration-evidence-v1";
export const BOND_HARD_PRICE_DECLARATION_NETWORK = "livenet";
export const BOND_HARD_PRICE_DECLARATION_APP = "amo.proofofwork.me";
export const BOND_HARD_PRICE_DECLARATION_AUTH_VERSION = "pwt-sale-v1";
export const BOND_HARD_PRICE_DECLARATION_LIFECYCLE =
  "list5/seal5/buy5/delist5";
export const BOND_HARD_PRICE_DECLARATION_MARKET_SURFACE = "AMO Bonds tab";
export const BOND_HARD_PRICE_DECLARATION_AUTHORITY_ADDRESS =
  "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
export const BOND_HARD_PRICE_DECLARATION_AUTHORITY_SCRIPT_PUBKEY =
  "76a91499b91dd27a616a71c0a1e9db6a86ceb8cff284c588ac";
export const BOND_HARD_PRICE_DECLARATION_TXID =
  "ae7baca8bddc950af2d19e515e4df551cbb33e2ad61aa072f862700135164284";
export const BOND_HARD_PRICE_DECLARATION_HEIGHT = 963_758;
export const BOND_HARD_PRICE_DECLARATION_BLOCK_HASH =
  "00000000000000000001ed0dd60f851c94458bfa5b6dea18271ca3c7c0700a64";
export const BOND_HARD_PRICE_DECLARATION_BLOCK_INDEX = 1_050;
export const BOND_HARD_PRICE_DECLARATION_MEMO_SHA256 =
  "71f0fa5a89947ff1a23c213501dc45451e6f0a4d59f5ec233915893315071bac";
export const BOND_HARD_PRICE_DECLARATION_MEMO_BYTES = 3_586;
export const BOND_HARD_PRICE_DECLARATION_PROTOCOL_VOUT = 2;
export const BOND_HARD_PRICE_DECLARATION_RECORD_ORDINAL = 0;
export const BOND_HARD_PRICE_ACTIVATION_HEIGHT = 963_759;
export const BOND_HARD_PRICE_WRITES_ENABLED = true;
export const BOND_HARD_PRICE_DECLARATION_TOKENS = Object.freeze([
  Object.freeze({
    displayName: "Infinity Bond",
    registryId: "infinity@proofofwork.me",
    ticker: "POWB",
    tokenId:
      "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562",
  }),
  Object.freeze({
    displayName: "Inception Bond",
    registryId: "inception@proofofwork.me",
    ticker: "INCB",
    tokenId:
      "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d",
  }),
]);

export function buildBondHardPriceDeclarationText() {
  return [
    "ProofOfWork.Me POWB and INCB Hard-Price Bond AMO Declaration",
    `network=${BOND_HARD_PRICE_DECLARATION_NETWORK}`,
    `app=${BOND_HARD_PRICE_DECLARATION_APP}`,
    `marketSurface=${BOND_HARD_PRICE_DECLARATION_MARKET_SURFACE}`,
    `authorizationVersion=${BOND_HARD_PRICE_DECLARATION_AUTH_VERSION}`,
    `lifecycle=${BOND_HARD_PRICE_DECLARATION_LIFECYCLE}`,
    `tokens=${BOND_HARD_PRICE_DECLARATION_TOKENS.map((token) => token.ticker).join(",")}`,
    `declarationAuthorityAddress=${BOND_HARD_PRICE_DECLARATION_AUTHORITY_ADDRESS}`,
    `declarationAuthorityScriptPubKey=${BOND_HARD_PRICE_DECLARATION_AUTHORITY_SCRIPT_PUBKEY}`,
    ...BOND_HARD_PRICE_DECLARATION_TOKENS.flatMap((token) => [
      `${token.ticker.toLowerCase()}DisplayName=${token.displayName}`,
      `${token.ticker.toLowerCase()}TokenId=${token.tokenId}`,
      `${token.ticker.toLowerCase()}RegistryId=${token.registryId}`,
    ]),
    "declarationPurpose=declares the canonical livenet AMO rule for hard-price POWB and INCB bond listings",
    "declarationEvidenceRule=this declaration is valid only when its transaction is confirmed and canonical, input zero spends the declared authority scriptPubKey, and the pinned protocol output and record contain this exact declaration text",
    "declarationSelectionRule=the earliest exact valid declaration transaction by confirmed block height then transaction index is authoritative; its exact carrier must be unambiguous, and a later duplicate cannot move activation",
    "activation=the first confirmed block after this declaration transaction",
    "valueSignalRule=mail recipients, self-send outputs, attached WORK, additional payments, and miner fee can signal value but are not declaration evidence and cannot change activation or listing terms",
    "quantityRule=the seller chooses any positive whole POWB or INCB quantity; the quantity is not constrained to a WORK face or fixed lot size",
    "priceRule=the seller chooses an exact positive integer total proof price; the listing does not derive price from floor, network value, or current WORK value",
    "hardPriceRule=confirmation freezes the signed pwt-sale-v1 quantity, price, seller, optional buyer lock, nonce, expiry, and ticket anchor",
    "nonRepricingRule=a later seal, buy, delist attempt, transfer, bond, floor move, network-value change, or WORK value change cannot derive a different amount or reprice the listing",
    "workSeparationRule=POWB and INCB are not governed WORK units; they have no WORK face, no unitAmountAtoms, no unitAmountSubatoms, and no WORK price oracle",
    "saleTicketLifecycleRule=list5 reserves seller balance and creates the seller-controlled ticket anchor; seal5 publishes the seller SIGHASH_SINGLE|ANYONECANPAY ticket signature; buy5 spends the ticket while paying seller price plus registry mutation fee; delist5 spends the ticket to cancel",
    "settlementRule=a confirmed bond listing may be sealed, bought, or delisted only against its frozen signed terms; settlement never selects a current value and never reprices",
    "amountStorageRule=POWB and INCB listing quantities are exact whole-token integers under their reserved synthetic assets",
    "issuanceSeparationRule=POWB and INCB issuance remains bound to confirmed Infinity Bond and Inception Bond projections; generic pwt1:create or pwt1:mint events cannot issue these reserved assets",
    "surfaceRule=AMO shows hard-price bond sale tickets in the Bonds tab with separate Inception and Infinity books; the Credits tab remains the non-bond credit and governed WORK market surface",
    "readinessFailureRule=declaration-evidence mismatch, incomplete pins, exact-tip disagreement, ambiguous carrier, or disabled protocol writes pauses official hard-price bond listing admission",
    "implementationRule=the open-source ProofOfWork.Me computer enforces this rule from canonical confirmed ProofOfWork state; pending mempool visibility is informational only",
  ].join("\n");
}

export function bondHardPriceDeclarationCommitment() {
  const text = buildBondHardPriceDeclarationText();
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

export function bondHardPriceDeclarationSubjectRecord() {
  return `pwm1:s:${Buffer.from(
    "ProofOfWork.Me POWB and INCB Hard-Price Bond AMO Declaration",
    "utf8",
  ).toString("base64")}`;
}

export function bondHardPriceDeclarationConfirmedPins() {
  return Object.freeze({
    activationHeight: BOND_HARD_PRICE_ACTIVATION_HEIGHT,
    declarationBlockHash: BOND_HARD_PRICE_DECLARATION_BLOCK_HASH,
    declarationBlockIndex: BOND_HARD_PRICE_DECLARATION_BLOCK_INDEX,
    declarationHeight: BOND_HARD_PRICE_DECLARATION_HEIGHT,
    declarationMemoBytes: BOND_HARD_PRICE_DECLARATION_MEMO_BYTES,
    declarationMemoSha256: BOND_HARD_PRICE_DECLARATION_MEMO_SHA256,
    declarationProtocolVout: BOND_HARD_PRICE_DECLARATION_PROTOCOL_VOUT,
    declarationRecordOrdinal: BOND_HARD_PRICE_DECLARATION_RECORD_ORDINAL,
    declarationTxid: BOND_HARD_PRICE_DECLARATION_TXID,
    writesEnabled: BOND_HARD_PRICE_WRITES_ENABLED,
  });
}

export function bondHardPriceDeclarationOnChainDraft() {
  const commitment = bondHardPriceDeclarationCommitment();
  return Object.freeze({
    authority: Object.freeze({
      address: BOND_HARD_PRICE_DECLARATION_AUTHORITY_ADDRESS,
      firstInputScriptPubKey:
        BOND_HARD_PRICE_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
    }),
    evidenceModel: BOND_HARD_PRICE_DECLARATION_EVIDENCE_MODEL,
    confirmedPins: bondHardPriceDeclarationConfirmedPins(),
    expectedProtocolRecordBytes: commitment.protocolRecordBytes,
    expectedProtocolRecordSha256: commitment.protocolRecordSha256,
    network: BOND_HARD_PRICE_DECLARATION_NETWORK,
    optionalValueSignals: Object.freeze([
      "mail recipients",
      "self-send outputs",
      "attached WORK",
      "additional payments",
      "miner fee",
    ]),
    protocolRecord: commitment.protocolRecord,
    protocolRecordBytes: commitment.protocolRecordBytes,
    protocolRecordSha256: commitment.protocolRecordSha256,
    subjectRecord: bondHardPriceDeclarationSubjectRecord(),
  });
}

export function bondHardPriceDeclarationCarrierEvidence(
  transaction,
  {
    commitment = bondHardPriceDeclarationCommitment(),
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

function firstInputPrevoutScriptPubKey(transaction) {
  return String(
    transaction?.vin?.[0]?.prevout?.scriptpubkey ??
      transaction?.vin?.[0]?.prevout?.scriptPubKey?.hex ??
      "",
  )
    .trim()
    .toLowerCase();
}

export function bondHardPriceDeclarationTransactionEvidence(
  transaction,
  {
    blockIndex,
    commitment = bondHardPriceDeclarationCommitment(),
    protocolVout = BOND_HARD_PRICE_DECLARATION_PROTOCOL_VOUT,
    recordOrdinal = BOND_HARD_PRICE_DECLARATION_RECORD_ORDINAL,
  } = {},
) {
  const carrier = bondHardPriceDeclarationCarrierEvidence(transaction, {
    commitment,
    protocolVout,
    recordOrdinal,
  });
  const authorityScriptPubKey = firstInputPrevoutScriptPubKey(transaction);
  const txid = String(transaction?.txid ?? "").trim().toLowerCase();
  const confirmed = transaction?.status?.confirmed === true;
  const blockHeight = Number(
    transaction?.status?.block_height ?? transaction?.blockHeight,
  );
  const blockHash = String(
    transaction?.status?.block_hash ?? transaction?.blockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const normalizedBlockIndex = Number(blockIndex);
  const commitmentMatchesPins =
    commitment.protocolRecordBytes === BOND_HARD_PRICE_DECLARATION_MEMO_BYTES &&
    commitment.protocolRecordSha256 ===
      BOND_HARD_PRICE_DECLARATION_MEMO_SHA256;
  const pinsComplete =
    txid === BOND_HARD_PRICE_DECLARATION_TXID &&
    confirmed &&
    blockHeight === BOND_HARD_PRICE_DECLARATION_HEIGHT &&
    blockHash === BOND_HARD_PRICE_DECLARATION_BLOCK_HASH &&
    Number.isSafeInteger(normalizedBlockIndex) &&
    normalizedBlockIndex === BOND_HARD_PRICE_DECLARATION_BLOCK_INDEX &&
    commitmentMatchesPins;
  const evidenceComplete =
    carrier !== null &&
    authorityScriptPubKey ===
      BOND_HARD_PRICE_DECLARATION_AUTHORITY_SCRIPT_PUBKEY &&
    pinsComplete;
  return Object.freeze({
    activationHeight: BOND_HARD_PRICE_ACTIVATION_HEIGHT,
    authorityScriptPubKey,
    blockHash,
    blockHeight,
    blockIndex: Number.isSafeInteger(normalizedBlockIndex)
      ? normalizedBlockIndex
      : null,
    carrier,
    commitmentMatchesPins,
    confirmed,
    confirmedPins: bondHardPriceDeclarationConfirmedPins(),
    evidenceComplete,
    expectedAuthorityScriptPubKey:
      BOND_HARD_PRICE_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
    expectedBlockHash: BOND_HARD_PRICE_DECLARATION_BLOCK_HASH,
    expectedBlockHeight: BOND_HARD_PRICE_DECLARATION_HEIGHT,
    expectedBlockIndex: BOND_HARD_PRICE_DECLARATION_BLOCK_INDEX,
    expectedProtocolRecordBytes: commitment.protocolRecordBytes,
    expectedProtocolRecordSha256: commitment.protocolRecordSha256,
    expectedProtocolVout: BOND_HARD_PRICE_DECLARATION_PROTOCOL_VOUT,
    expectedRecordOrdinal: BOND_HARD_PRICE_DECLARATION_RECORD_ORDINAL,
    expectedTxid: BOND_HARD_PRICE_DECLARATION_TXID,
    model: BOND_HARD_PRICE_DECLARATION_EVIDENCE_MODEL,
    pinsComplete,
    txid,
    writesEnabled: BOND_HARD_PRICE_WRITES_ENABLED,
  });
}
