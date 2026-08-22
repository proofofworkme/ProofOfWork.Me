import { createHash } from "node:crypto";

export const BOND_HARD_PRICE_DECLARATION_NETWORK = "livenet";
export const BOND_HARD_PRICE_DECLARATION_APP = "amo.proofofwork.me";
export const BOND_HARD_PRICE_DECLARATION_AUTH_VERSION = "pwt-sale-v1";
export const BOND_HARD_PRICE_DECLARATION_LIFECYCLE =
  "list5/seal5/buy5/delist5";
export const BOND_HARD_PRICE_DECLARATION_MARKET_SURFACE = "AMO Bonds tab";
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
    ...BOND_HARD_PRICE_DECLARATION_TOKENS.flatMap((token) => [
      `${token.ticker.toLowerCase()}DisplayName=${token.displayName}`,
      `${token.ticker.toLowerCase()}TokenId=${token.tokenId}`,
      `${token.ticker.toLowerCase()}RegistryId=${token.registryId}`,
    ]),
    "declarationPurpose=declares the canonical current livenet AMO rule for hard-price POWB and INCB bond listings; it records the current sale-ticket behavior and does not require a new activation height",
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
