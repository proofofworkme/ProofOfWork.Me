import { createHash } from "node:crypto";
import { canonicalProtocolCandidateFromOutput } from "./canonical-op-return.mjs";
import { WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY, WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS } from "./work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "./work-units.mjs";
import {
  WORK_AMO_EXPANDED_FACE_PROOFS, WORK_AMO_LISTING_REGISTRY_SCRIPT,
  WORK_AMO_LIQUIDITY_FEE_ADDRESS, WORK_AMO_LIQUIDITY_FEE_SATS,
} from "../src/shared/protocol/workAmoExpandedLiquidity.mjs";

export const EXPANDED_LIQUIDITY_MODEL = "work-amo-expanded-liquidity-v1";
// This one transaction carried the reviewed declaration inside an additional PWM wrapper
// and returned the dust to its authority. Its inclusion position is resolved on the active chain.
const EXCEPTION_TXID = "57eb549372f2318bfc3ade62c62e9e1092cd42702e9ffb5e2733659acc241f33";
const EXCEPTION_INPUT_TXID = "c61b5aec19fc4c66b4653a30b48a5ffc8f19b96c978e871ed661ae45479cb582";
const EXCEPTION_SCRIPT_SHA256 = "27638b9bdd1f312cf8eb68f419174b4a83b45ef42ce4072803abefbc759fc900";
const EXCEPTION_WITNESS = Object.freeze({
  recognition: "exact-declaration-txid-exception",
  registryPaymentSats: 0,
  selfPaymentVout: 0,
  selfPaymentSats: 546,
  carrierPayloadSha256: "d046f13915f8fd9d2422d8fd41134b2f6447649b289982cd2e27fd6321488476",
});

const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function expandedLiquidityDeclarationRecord(boundary) {
  const { firstEligibleBlockOffset: blocks, firstEligibleTransactionIndex: index } = boundary ?? {};
  if (!integer(blocks) || !integer(index) || (blocks === 0 && index === 0)) return null;
  return [
    "pwm1:m:ProofOfWork.Me WORK AMO Expanded Liquidity Declaration",
    `model=${EXPANDED_LIQUIDITY_MODEL}`, "network=livenet", `tokenId=${WORK_TOKEN_ID}`,
    "extends=pwt-sale-v8", `addedUnitFaceProofs=${WORK_AMO_EXPANDED_FACE_PROOFS}`,
    `authorityInputZero=${WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY}`,
    `declarationRegistry=${WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS};minimumSats=546`,
    "authority=one exact canonical confirmed carrier, one qualifying declaration registry output, and the pinned authority input",
    `firstEligibleBlockOffset=${blocks}`, `firstEligibleTransactionIndex=${index}`,
    "eligibility=height is relative to confirmed declaration block; transaction index is relative to declaration transaction when block offset is zero and absolute otherwise; eligible from that position onward",
    "list=pwt1:list5;version=pwt-sale-v8;registrySats=546;anchorVout=2;anchorSats=546",
    `liquidityFeeSats=${WORK_AMO_LIQUIDITY_FEE_SATS};liquidityFeeAddress=${WORK_AMO_LIQUIDITY_FEE_ADDRESS}`,
    "payment=one exact distinct liquidity fee output at List; registry and liquidity fees contribute once to marketplace fees after deriving terms; the locked ticket and miner fee remain separate",
    "terms=derive exact WORK subatoms from the signed face using the V8 position-ordered formula; freeze and settle under the same V8 authorization",
    "continuity=the 25000-proof declaration, pending and confirmed listings, seal, settlement, transfers, precision, and historical terms continue unchanged",
  ].join("\n");
}

export function normalizeExpandedLiquidityPins(value) {
  const record = expandedLiquidityDeclarationRecord(value);
  if (!record || !hash(value.txid) || !hash(value.blockHash) ||
      !integer(value.blockHeight) || value.blockHeight < 1 ||
      !integer(value.blockTransactionIndex) || value.blockTransactionIndex < 1 ||
      !integer(value.protocolVout) || value.recordOrdinal !== 0) return null;
  const exception = value.txid === EXCEPTION_TXID;
  if (exception) {
    if (value.protocolVout !== 1 || !Object.hasOwn(value, "registryPaymentVout") || value.registryPaymentVout !== null ||
        value.firstEligibleBlockOffset !== 1 || value.firstEligibleTransactionIndex !== 0 ||
        Object.entries(EXCEPTION_WITNESS).some(([key, expected]) => Object.hasOwn(value, key) && value[key] !== expected)) return null;
  } else if (!integer(value.registryPaymentVout) || value.protocolVout === value.registryPaymentVout) return null;
  if (!integer(value.blockHeight + value.firstEligibleBlockOffset) ||
      !integer(value.firstEligibleTransactionIndex +
        (value.firstEligibleBlockOffset === 0 ? value.blockTransactionIndex : 0))) return null;
  return {
    model: EXPANDED_LIQUIDITY_MODEL, txid: value.txid, blockHeight: value.blockHeight,
    blockHash: value.blockHash, blockTransactionIndex: value.blockTransactionIndex,
    protocolVout: value.protocolVout, recordOrdinal: 0, registryPaymentVout: value.registryPaymentVout,
    firstEligibleBlockOffset: value.firstEligibleBlockOffset,
    firstEligibleTransactionIndex: value.firstEligibleTransactionIndex,
    recordSha256: createHash("sha256").update(record, "utf8").digest("hex"),
    ...(exception ? EXCEPTION_WITNESS : {}),
  };
}

function matchesPins(evidence, pins) {
  return Object.entries(pins).every(([key, expected]) => evidence[key] === expected);
}

export function expandedLiquidityPositionEligible(context, position) {
  const pins = normalizeExpandedLiquidityPins(context);
  if (!pins || !matchesPins(context, pins) ||
      !integer(position?.blockHeight) || !integer(position.blockTransactionIndex) ||
      !hash(position.blockHash) ||
      (position.blockHeight === pins.blockHeight && position.blockHash !== pins.blockHash)) return false;
  const firstHeight = pins.blockHeight + pins.firstEligibleBlockOffset;
  const firstIndex = pins.firstEligibleTransactionIndex +
    (pins.firstEligibleBlockOffset === 0 ? pins.blockTransactionIndex : 0);
  return position.blockHeight > firstHeight ||
    (position.blockHeight === firstHeight && position.blockTransactionIndex >= firstIndex);
}

// Core hydration binds these inputs and outputs to the raw txid and retrieves the
// actual prevout. The fixed output vector also rules out any other carrier or registry payment.
function matchesExceptionalTransaction(transaction, record) {
  const input = transaction.vin[0];
  const [self, carrier, change] = transaction.vout;
  if (!Array.isArray(transaction.vin) || transaction.vin.length !== 1 ||
      input.txid !== EXCEPTION_INPUT_TXID || input.vout !== 0 ||
      input.prevout.value !== 3019 || transaction.vout.length !== 3 ||
      self?.scriptpubkey !== WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY || self.value !== EXCEPTION_WITNESS.selfPaymentSats ||
      carrier?.value !== 0 || typeof carrier.scriptpubkey !== "string" ||
      change?.scriptpubkey !== WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY || change.value !== 2222) return false;
  const candidate = canonicalProtocolCandidateFromOutput({ scriptpubkey: carrier.scriptpubkey });
  return candidate?.decodeValid === true && candidate.scriptPubKeyHex === carrier.scriptpubkey &&
    candidate.payloadHex === Buffer.from(`pwm1:m:${record}`, "utf8").toString("hex") &&
    createHash("sha256").update(Buffer.from(carrier.scriptpubkey, "hex")).digest("hex") === EXCEPTION_SCRIPT_SHA256;
}

// The caller independently resolves the active-chain block/hash and its transaction list.
// A hydrated transaction or a configured txid by itself cannot activate a rule.
export function verifyExpandedLiquidityDeclaration(pinsValue, { transaction, canonicalBlock, canonicalHash, indexedPosition } = {}) {
  const pins = normalizeExpandedLiquidityPins(pinsValue);
  if (!pins || transaction?.txid !== pins.txid || transaction?.status?.confirmed !== true ||
      transaction.status.block_height !== pins.blockHeight || transaction.status.block_hash !== pins.blockHash ||
      canonicalHash !== pins.blockHash || canonicalBlock?.hash !== pins.blockHash ||
      canonicalBlock.height !== pins.blockHeight || canonicalBlock.tx?.[pins.blockTransactionIndex] !== pins.txid ||
      indexedPosition?.txid !== pins.txid || indexedPosition.blockHash !== pins.blockHash ||
      indexedPosition.blockHeight !== pins.blockHeight || indexedPosition.blockIndex !== pins.blockTransactionIndex ||
      transaction.vin?.[0]?.prevout?.scriptpubkey !== WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY ||
      !Array.isArray(transaction.vout)) return null;
  const record = expandedLiquidityDeclarationRecord(pins);
  if (pins.txid === EXCEPTION_TXID) return matchesExceptionalTransaction(transaction, record) ? pins : null;
  const carriers = [], payments = [];
  for (const [vout, output] of transaction.vout.entries()) {
    const candidate = canonicalProtocolCandidateFromOutput(output);
    if (candidate?.decodeValid === true && candidate.text === record) carriers.push(vout);
    if (output?.scriptpubkey === WORK_AMO_LISTING_REGISTRY_SCRIPT &&
        Number.isSafeInteger(output.value) && output.value >= 546) payments.push(vout);
  }
  return carriers.length === 1 && carriers[0] === pins.protocolVout &&
    payments.length === 1 && payments[0] === pins.registryPaymentVout ? pins : null;
}

export function expandedLiquidityTransitionMatches(transition, declaration, blockHeight, blockHash) {
  const body = transition?.payload;
  const replayed = body?.expandedLiquidity;
  if (declaration?.txid === EXCEPTION_TXID) {
    const pins = normalizeExpandedLiquidityPins(declaration);
    if (!pins || !matchesPins(declaration, pins)) return false;
  }
  return Boolean(declaration && body?.network === "livenet" && body.complete === true &&
    body.blockAtomic === true && body.invalidZero === true && body.feeOnce === true &&
    body.blockHeight === blockHeight && body.blockHash === blockHash &&
    body.transitionChainCommitment?.model === "canonical-work-amo-raw-transition-chain-sha256-v1" &&
    hash(body.transitionChainCommitment.sha256) && replayed &&
    matchesPins(replayed, declaration));
}

// Once an exact boundary is replayed, the verified H-1 transition carries its declaration onto
// the same canonical branch. A missing transition cannot be bridged by rereading a later tip.
export async function expandedLiquidityForReplay({ blockHeight, previousBlockHash, priorTransition,
  configuredPins, readBoundary }) {
  const prior = normalizeExpandedLiquidityPins(priorTransition?.payload?.expandedLiquidity);
  if (prior && blockHeight > prior.blockHeight + prior.firstEligibleBlockOffset &&
      expandedLiquidityTransitionMatches(priorTransition, prior, blockHeight - 1, previousBlockHash)) return prior;
  const pins = normalizeExpandedLiquidityPins(configuredPins);
  if (!pins || blockHeight !== pins.blockHeight + pins.firstEligibleBlockOffset) return null;
  return readBoundary();
}

export async function expandedLiquidityReadiness({
  declaration, tipHeight, tipHash, baseAdmissionReady, writesEnabled,
  readCanonicalHash, readTransition, readSchema, readTip,
}) {
  const result = { declaration, tipHeight, tipHash, listingWritesEnabled: false, schemaReady: false,
    replayReady: false, reasonCode: "work-amo-expanded-liquidity-declaration-unavailable" };
  if (!declaration) return result;
  const firstHeight = declaration.blockHeight + declaration.firstEligibleBlockOffset;
  if (!integer(tipHeight) || tipHeight < firstHeight || !hash(tipHash)) return result;
  try {
    const firstHash = firstHeight === tipHeight ? tipHash : await readCanonicalHash(firstHeight);
    const [firstTransition, currentTransition, schemaReady] = await Promise.all([
      readTransition(firstHeight, firstHash),
      firstHeight === tipHeight ? null : readTransition(tipHeight, tipHash),
      readSchema(),
    ]);
    const lastTransition = firstHeight === tipHeight ? firstTransition : currentTransition;
    result.schemaReady = schemaReady === true;
    result.replayReady = expandedLiquidityTransitionMatches(firstTransition, declaration, firstHeight, firstHash) &&
      expandedLiquidityTransitionMatches(lastTransition, declaration, tipHeight, tipHash);
    const tip = await readTip();
    if (tip?.height !== tipHeight || tip?.blockHash !== tipHash) {
      result.replayReady = false;
      result.reasonCode = "work-amo-expanded-liquidity-tip-changed";
      return result;
    }
    result.listingWritesEnabled = result.schemaReady && result.replayReady &&
      baseAdmissionReady === true && writesEnabled === true;
    result.reasonCode = result.listingWritesEnabled ? "" :
      !result.schemaReady ? "work-amo-expanded-liquidity-schema-unavailable" :
      !result.replayReady ? "work-amo-expanded-liquidity-replay-unavailable" :
      "work-amo-expanded-liquidity-writes-paused";
  } catch {
    result.replayReady = false;
    result.reasonCode = "work-amo-expanded-liquidity-readiness-unavailable";
  }
  return result;
}
