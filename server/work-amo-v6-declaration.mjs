import { createHash } from "node:crypto";
import {
  WORK_AMO_V6_ALLOWED_FACE_USD_CENTS,
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
import {
  WORK_USD_ATTESTATION_MODEL,
  WORK_USD_ATTESTATION_VERSION,
  WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
  WORK_USD_ORACLE_MAX_SPREAD_BPS,
  WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
  WORK_USD_ORACLE_MINIMUM_SOURCES,
  WORK_USD_ORACLE_SOURCE_IDS,
  workUsdOracleKeyIdFromPublicKey,
} from "./work-usd-oracle.mjs";

const HEX_32_PATTERN = /^[0-9a-f]{64}$/u;

function canonicalHex32(value, label) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!HEX_32_PATTERN.test(text)) {
    throw new TypeError(`${label} must be 32-byte lowercase hex`);
  }
  return text;
}

export function buildWorkAmoV6DeclarationText({
  oracleKeyId,
  oraclePublicKey,
} = {}) {
  const publicKey = canonicalHex32(
    oraclePublicKey,
    "oraclePublicKey",
  );
  const keyId = canonicalHex32(oracleKeyId, "oracleKeyId");
  const derivedKeyId =
    workUsdOracleKeyIdFromPublicKey(publicKey);
  if (keyId !== derivedKeyId) {
    throw new TypeError(
      "oracleKeyId does not match oraclePublicKey",
    );
  }
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
    `allowedFaceUsdCents=${WORK_AMO_V6_ALLOWED_FACE_USD_CENTS.join(",")}`,
    "allowedFaceUsd=20,50,100",
    `unitModel=${WORK_AMO_V6_UNIT_MODEL}`,
    `stateOrderModel=${WORK_AMO_V6_STATE_ORDER_MODEL}`,
    `amountModel=${WORK_AMO_V6_AMOUNT_MODEL}`,
    `bondTransitionModel=${WORK_AMO_V6_BOND_TRANSITION_MODEL}`,
    `blockSequencerModel=${WORK_AMO_V6_BLOCK_SEQUENCER_MODEL}`,
    `workOracleModel=${WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL}`,
    `usdAttestationVersion=${WORK_USD_ATTESTATION_VERSION}`,
    `usdAttestationModel=${WORK_USD_ATTESTATION_MODEL}`,
    "usdAttestationSignature=BIP340-Schnorr-SHA256",
    `oraclePublicKey=${publicKey}`,
    `oracleKeyId=${keyId}`,
    `oracleSources=${WORK_USD_ORACLE_SOURCE_IDS.join(",")}`,
    "oracleSourceEndpoints=bitfinex:https://api-pub.bitfinex.com/v2/ticker/tBTCUSD|bitflyer:https://api.bitflyer.com/v1/getticker?product_code=BTC_USD|coinbase:https://api.coinbase.com/v2/prices/BTC-USD/spot|gemini:https://api.gemini.com/v1/pubticker/btcusd|kraken:https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
    `oracleMinimumDistinctFreshSources=${WORK_USD_ORACLE_MINIMUM_SOURCES}`,
    `oracleFreshnessWindowMs=${WORK_USD_ORACLE_FRESHNESS_WINDOW_MS}`,
    `oracleMaximumSpreadBps=${WORK_USD_ORACLE_MAX_SPREAD_BPS}`,
    `oracleMaximumValidityBlocks=${WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS}`,
    "oracleConsensus=sort distinct approved fresh observations by sourceId; convert exact decimal USD per 100000000 proofs to integer Q8; take the integer median; for an even source count use floor((lowerMiddle+upperMiddle)/2); require (maximum-minimum)*10000<=median*200",
    "attestationBinding=the signed closed attestation commits to this declaration transaction id, network, oracle identity, reference block height and hash, validity interval, issue time, fixed policy, exact source observations, source-set hash, and median price",
    "attestationWindow=validFromHeight=referenceBlockHeight+1; validThroughHeight<=referenceBlockHeight+12; the confirmed listing height must be inside this interval and the reference hash must remain canonical",
    "positionOrder=confirmed block height, then transaction index in that block, then protocol output index, then record ordinal",
    "arithmeticOrder=integer multiplication and division only; multiplication before division; floor and ceiling are applied only where explicitly declared",
    "unitFormulaDefinitions=F=face USD cents; P=usdPer100mProofsQ8; N=networkValueBeforeQ8; S=21000000; A=100000000 atoms per WORK; Q=100000000; R=100000000 proofs",
    "unitFormula=Tn=F*R*Q;Td=100*P;unitPriceProofs=ceil(Tn/Td);unitAmountAtoms=floor(Tn*S*A*Q/(Td*N));unitMinimumPriceProofs=ceil(unitAmountAtoms*N/(S*A*Q))",
    "confirmationRule=the face and signed attestation are authorized before broadcast; the exact amount, price, minimum, N-before, listing position, and bond transition are derived and frozen only at confirmed canonical position",
    "computeThenBondRule=derive listing terms from N-before after every earlier canonical protocol event; after successful validation add this listing record's distinct registry-payment contribution to its record-level N-after; apply each transaction's miner-fee contribution exactly once after all protocol records in that transaction and before the next transaction",
    "settlementRule=a confirmed listing may be sealed or purchased using its frozen terms even after its attestation window expires; settlement never selects a current quote and never reprices",
    "failureRule=missing declaration, wrong key, invalid signature, unapproved or duplicate source, fewer than three fresh sources, excessive spread, noncanonical reference block, expired window, disallowed face, derived field in the signed listing authorization, insufficient WORK, or arithmetic mismatch makes the new listing invalid",
    "historyRule=V5 pwa1 quote records and all earlier marketplace records remain immutable replayable history but do not govern V6 listing creation",
    "keyRule=the oracle key is non-funding; changing it requires a new confirmed declaration",
    "implementationRule=the open-source ProofOfWork.Me computer enforces these rules; no recurring on-chain price publication is required",
  ].join("\n");
  return declaration;
}

export function workAmoV6DeclarationCommitment(options = {}) {
  const text = buildWorkAmoV6DeclarationText(options);
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
