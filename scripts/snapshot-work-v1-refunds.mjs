import { readFile, writeFile } from "node:fs/promises";

const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const DECLARATION_TXID =
  "4c53252c6e9279726e1456f4d846274bfa33f778b633d32a68ed36906b38083f";
const CUTOVER_HEIGHT = 959061;
const ACTIVATION_HEIGHT = 959062;
const SEAL_PAYMENT_SATS = 546;

const sourcePath = process.argv[2];
const outputPath =
  process.argv[3] ?? "WORK_MARKET_V1_REFUNDS_959061.json";
if (!sourcePath) {
  throw new Error(
    "Usage: node scripts/snapshot-work-v1-refunds.mjs <token-state.json> [output.json]",
  );
}

const payload = JSON.parse(await readFile(sourcePath, "utf8"));
const byListingId = new Map();
for (const listing of Array.isArray(payload.listings) ? payload.listings : []) {
  const version = String(listing?.saleAuthorization?.version ?? "");
  if (
    listing?.confirmed !== true ||
    listing?.tokenId !== WORK_TOKEN_ID ||
    !["pwt-sale-v1", "pwt-sale-v2"].includes(version) ||
    !Number.isSafeInteger(listing?.blockHeight) ||
    listing.blockHeight > CUTOVER_HEIGHT ||
    !/^[0-9a-f]{64}$/u.test(String(listing?.listingId ?? ""))
  ) {
    continue;
  }
  byListingId.set(listing.listingId, listing);
}

const listings = [...byListingId.values()]
  .map((listing) => {
    const sealed = listing.sealConfirmed === true;
    const listingMinerFeeSats = Math.max(0, Number(listing.minerFeeSats) || 0);
    const sealMinerFeeSats = sealed
      ? Math.max(0, Number(listing.sealMinerFeeSats) || 0)
      : 0;
    const sealPaymentSats = sealed ? SEAL_PAYMENT_SATS : 0;
    return {
      listingBlockHeight: listing.blockHeight,
      listingId: listing.listingId,
      listingMinerFeeSats,
      refundSats:
        listingMinerFeeSats + sealMinerFeeSats + sealPaymentSats,
      sealMinerFeeSats,
      sealPaymentSats,
      sealTxid: sealed ? String(listing.sealTxid ?? "") : "",
      sealed,
      sellerAddress: listing.sellerAddress,
      version: listing.saleAuthorization.version,
    };
  })
  .sort(
    (left, right) =>
      left.sellerAddress.localeCompare(right.sellerAddress) ||
      left.listingId.localeCompare(right.listingId),
  );

const sellerMap = new Map();
for (const listing of listings) {
  const seller = sellerMap.get(listing.sellerAddress) ?? {
    listingCount: 0,
    listingIds: [],
    listingMinerFeeSats: 0,
    refundSats: 0,
    sealMinerFeeSats: 0,
    sealPaymentSats: 0,
    sealedListingCount: 0,
    sellerAddress: listing.sellerAddress,
  };
  seller.listingCount += 1;
  seller.listingIds.push(listing.listingId);
  seller.listingMinerFeeSats += listing.listingMinerFeeSats;
  seller.refundSats += listing.refundSats;
  seller.sealMinerFeeSats += listing.sealMinerFeeSats;
  seller.sealPaymentSats += listing.sealPaymentSats;
  seller.sealedListingCount += Number(listing.sealed);
  sellerMap.set(listing.sellerAddress, seller);
}
const sellers = [...sellerMap.values()].sort((left, right) =>
  left.sellerAddress.localeCompare(right.sellerAddress),
);
const total = (field) =>
  listings.reduce((sum, listing) => sum + Number(listing[field] ?? 0), 0);

const snapshot = {
  activation: {
    activationHeight: ACTIVATION_HEIGHT,
    cutoverHeight: CUTOVER_HEIGHT,
    declarationTxid: DECLARATION_TXID,
  },
  policy: {
    eligibility:
      "Confirmed active WORK pwt-sale-v1/v2 listings at cutover height 959061",
    excluded:
      "Pending, invalid, sold, delisted, or otherwise closed before cutover",
    refundFormula:
      "listing miner fee + confirmed seal miner fee + 546-proof confirmed seal payment",
    saleTicketOutput:
      "The 546-proof sale-ticket output remains seller-controlled and is not a refund expense",
  },
  source: {
    indexedAt: payload.indexedAt,
    indexedThroughBlock: payload.indexedThroughBlock,
  },
  totals: {
    listingCount: listings.length,
    listingMinerFeeSats: total("listingMinerFeeSats"),
    refundSats: total("refundSats"),
    sealMinerFeeSats: total("sealMinerFeeSats"),
    sealPaymentSats: total("sealPaymentSats"),
    sealedListingCount: listings.filter((listing) => listing.sealed).length,
    sellerCount: sellers.length,
  },
  sellers,
  listings,
};

await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(JSON.stringify(snapshot.totals));
