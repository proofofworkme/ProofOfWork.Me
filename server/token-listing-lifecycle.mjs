import { WORK_TOKEN_ID } from "./work-units.mjs";
import { WORK_AMO_EXPANDED_FACE_PROOFS, WORK_AMO_LIQUIDITY_FEE_ADDRESS,
  WORK_AMO_LIQUIDITY_FEE_SATS } from "../src/shared/protocol/workAmoExpandedLiquidity.mjs";
import { workAmoBookFace } from "../src/shared/protocol/workAmoBookFace.mjs";

const TXID_PATTERN = /^[0-9a-f]{64}$/u;

export function tokenListingTransactionCanProjectActive(status) {
  return ["confirmed", "pending"].includes(
    String(status ?? "").trim().toLowerCase(),
  );
}

export function tokenListingCanProjectCloseActivity(listing) {
  const closedTxid = String(listing?.closedTxid ?? "")
    .trim()
    .toLowerCase();
  return (
    listing?.closedConfirmed === true &&
    TXID_PATTERN.test(closedTxid)
  );
}

export function workListingFaceProofs(listing) {
  return listing?.tokenId === WORK_TOKEN_ID ? workAmoBookFace(listing) : undefined;
}

// Read the verified opening event. The amount locked in the sale ticket is
// principal. Only the two separately validated payments enter List fee flow.
export function workListingLiquidityPayment(listing) {
  if (workListingFaceProofs(listing) !== WORK_AMO_EXPANDED_FACE_PROOFS) return null;
  const { liquidityFeeSats, liquidityFeeVout } = listing;
  if (liquidityFeeSats !== WORK_AMO_LIQUIDITY_FEE_SATS ||
      !Number.isSafeInteger(liquidityFeeVout) || liquidityFeeVout < 0 || liquidityFeeVout === 2) {
    throw new Error("Expanded WORK listing is missing its verified liquidity fee output.");
  }
  return { liquidityFeeSats, liquidityFeeVout, liquidityFeeAddress: WORK_AMO_LIQUIDITY_FEE_ADDRESS };
}
