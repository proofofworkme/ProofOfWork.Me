import assert from "node:assert/strict";
import fs from "node:fs";
import {
  WORK_MARKET_V2_AUTH_VERSION,
  WORK_MARKET_V2_DECLARATION_TXID,
  WORK_MARKET_V2_ORACLE_MODEL,
  validateWorkMarketV2Authorization,
  workMarketV2ActivationFromDeclaration,
  workMarketV2MinimumPriceSats,
} from "../server/work-market-v2.mjs";

const hash = "11".repeat(32);
const base = {
  amountAtoms: "100000000",
  minimumPriceSats: "1",
  oracleBlockHash: hash,
  oracleBlockHeight: 100,
  oracleModel: WORK_MARKET_V2_ORACLE_MODEL,
  oracleNetworkValueQ8: "2100000000000000",
  priceSats: 1,
  version: WORK_MARKET_V2_AUTH_VERSION,
};

assert.equal(workMarketV2MinimumPriceSats("100000000", "2100000000000000"), 1n);
assert.equal(workMarketV2MinimumPriceSats("1", "2100000000000000"), 1n);
assert.equal(workMarketV2MinimumPriceSats("100000000", "2100000000000001"), 2n);
assert.equal(
  validateWorkMarketV2Authorization(base, {
    actionBlockHeight: 101,
    expectedNetworkValueQ8: base.oracleNetworkValueQ8,
    expectedOracleBlockHash: hash,
  }).valid,
  true,
);
assert.equal(
  validateWorkMarketV2Authorization({ ...base, priceSats: 0 }).reasonCode,
  "work-market-v2-oracle-fields-invalid",
);
assert.equal(
  validateWorkMarketV2Authorization({
    ...base,
    minimumPriceSats: "2",
    oracleNetworkValueQ8: "2100000000000001",
    priceSats: 1,
  }).reasonCode,
  "work-market-v2-below-floor",
);
assert.equal(
  validateWorkMarketV2Authorization({
    ...base,
    minimumPriceSats: "2",
    oracleNetworkValueQ8: "2100000000000001",
    priceSats: 3,
  }).valid,
  true,
);
assert.equal(
  validateWorkMarketV2Authorization(
    { ...base, minimumPriceSats: "2", priceSats: 2 },
  ).reasonCode,
  "work-market-v2-minimum-price-mismatch",
);
assert.equal(
  validateWorkMarketV2Authorization(base, { actionBlockHeight: 102 }).reasonCode,
  "work-market-v2-oracle-height-stale",
);
assert.equal(
  validateWorkMarketV2Authorization(base, {
    expectedOracleBlockHash: "22".repeat(32),
  }).reasonCode,
  "work-market-v2-oracle-hash-mismatch",
);
assert.deepEqual(
  workMarketV2ActivationFromDeclaration({
    blockHash: hash,
    blockHeight: 100,
    confirmed: true,
    txid: WORK_MARKET_V2_DECLARATION_TXID,
  }),
  {
    activationHeight: 101,
    declarationBlockHash: hash,
    declarationHeight: 100,
    declarationTxid: WORK_MARKET_V2_DECLARATION_TXID,
  },
);
assert.equal(
  workMarketV2ActivationFromDeclaration({
    blockHash: hash,
    blockHeight: 100,
    confirmed: false,
    txid: WORK_MARKET_V2_DECLARATION_TXID,
  }),
  null,
);

const apiSource = fs.readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const readerSource = fs.readFileSync(
  new URL("../server/db/proof-index-reader.mjs", import.meta.url),
  "utf8",
);
const contractSource = fs.readFileSync(
  new URL("../server/work-market-v2.mjs", import.meta.url),
  "utf8",
);
const refundSnapshot = JSON.parse(
  fs.readFileSync(
    new URL("../WORK_MARKET_V1_REFUNDS_959061.json", import.meta.url),
    "utf8",
  ),
);
assert.deepEqual(refundSnapshot.totals, {
  listingCount: 94,
  listingMinerFeeSats: 160580,
  refundSats: 295660,
  sealMinerFeeSats: 102866,
  sealPaymentSats: 32214,
  sealedListingCount: 59,
  sellerCount: 37,
});
assert.equal(new Set(refundSnapshot.listings.map((row) => row.listingId)).size, 94);
assert.equal(
  refundSnapshot.listings.reduce((sum, row) => sum + row.refundSats, 0),
  refundSnapshot.totals.refundSats,
);
assert.equal(
  refundSnapshot.sellers.reduce((sum, row) => sum + row.refundSats, 0),
  refundSnapshot.totals.refundSats,
);
for (const source of [appSource, readerSource, contractSource]) {
  assert.match(source, /pwt-sale-v3/u);
}
assert.match(apiSource, /workMarketV2TargetOracle/u);
assert.match(apiSource, /work-market-v2-canonical-oracle-unavailable/u);
assert.match(apiSource, /deactivateLegacyWorkListingsAtCutover/u);
assert.match(apiSource, /work-market-v2-cutover/u);
assert.match(appSource, /assertWorkMarketV2DeclarationConfirmed/u);
assert.match(appSource, /This WORK listing is below the current network value/u);
assert.match(appSource, /Marketplace V1 Relic/u);
assert.match(appSource, /disabledAtBlockHeight: 959062/u);
assert.match(readerSource, /'pwt-sale-v3'/u);

console.log("WORK Marketplace V2 pricing contract passed.");
