import assert from "node:assert/strict";
import fs from "node:fs";
import * as bitcoin from "bitcoinjs-lib";
import {
  classifyWorkMarketV2CutoverRows,
  runWorkMarketV2CutoverMigration,
  WORK_MARKET_V2_CUTOVER_REASON_CODE,
  WORK_MARKET_V2_CUTOVER_TARGETS,
} from "./migrate-work-market-v2-cutover.mjs";
import {
  applyWorkMarketV2CutoverToTokenState,
  WORK_MARKET_V2_AUTH_VERSION,
  WORK_MARKET_V2_ACTIVATION_HEIGHT,
  WORK_MARKET_V2_DECLARATION_BLOCK_HASH,
  WORK_MARKET_V2_DECLARATION_HEIGHT,
  WORK_MARKET_V2_DECLARATION_TXID,
  WORK_MARKET_V2_ORACLE_MODEL,
  validateGovernedWorkMarketAction,
  validateWorkMarketV2Authorization,
  workMarketV2ActivationFromDeclaration,
  workMarketV2ActivationForReplay,
  workMarketV2MinimumPriceSats,
} from "../server/work-market-v2.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";

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
const governedBase = { ...base, tokenId: WORK_TOKEN_ID };
assert.equal(
  validateGovernedWorkMarketAction(governedBase, {
    actionBlockHeight: 101,
    activationHeight: 101,
  }).reasonCode,
  "work-market-v2-canonical-oracle-unavailable",
);

const pristineMigrationRows = WORK_MARKET_V2_CUTOVER_TARGETS.map(
  (target, index) => ({
    block_height: target.blockHeight,
    event_id: index + 1,
    kind: target.kind,
    payload: {
      saleAuthorization: { version: target.version },
    },
    status: "confirmed",
    txid: target.txid,
    valid: true,
    validation_errors: [],
    version: target.version,
  }),
);
assert.deepEqual(
  classifyWorkMarketV2CutoverRows(pristineMigrationRows),
  { alreadyMigratedEventIds: [], pristineEventIds: [1, 2] },
);
const migratedMigrationRows = pristineMigrationRows.map((row) => ({
  ...row,
  payload: {
    ...row.payload,
    reason: WORK_MARKET_V2_CUTOVER_REASON_CODE,
    reasonCode: WORK_MARKET_V2_CUTOVER_REASON_CODE,
    refundEligible: false,
    relic: false,
    valid: false,
    validationErrors: [WORK_MARKET_V2_CUTOVER_REASON_CODE],
  },
  valid: false,
  validation_errors: [WORK_MARKET_V2_CUTOVER_REASON_CODE],
}));
assert.deepEqual(
  classifyWorkMarketV2CutoverRows(migratedMigrationRows),
  { alreadyMigratedEventIds: [1, 2], pristineEventIds: [] },
);
assert.throws(
  () =>
    classifyWorkMarketV2CutoverRows([
      { ...pristineMigrationRows[0], valid: false },
      pristineMigrationRows[1],
    ]),
  /inconsistent pre-migration state/u,
);

const migrationRows = structuredClone(pristineMigrationRows);
let migrationUpdateCalls = 0;
let unsupportedProjectionRows = [];
const migrationClient = {
  async query(sql, params = []) {
    const text = String(sql).trim();
    if (
      ["BEGIN", "COMMIT", "ROLLBACK"].includes(text) ||
      text.startsWith("LOCK TABLE")
    ) {
      return { rows: [] };
    }
    if (text.startsWith("SELECT")) {
      if (text.includes("FROM proof_indexer.credit_listings cl")) {
        return { rows: structuredClone(unsupportedProjectionRows) };
      }
      return { rows: structuredClone(migrationRows) };
    }
    if (text.startsWith("UPDATE")) {
      migrationUpdateCalls += 1;
      const eventIds = new Set(params[0].map(Number));
      const updated = [];
      for (let index = 0; index < migrationRows.length; index += 1) {
        const row = migrationRows[index];
        if (!eventIds.has(Number(row.event_id)) || row.valid !== true) {
          continue;
        }
        migrationRows[index] = structuredClone(
          migratedMigrationRows.find(
            (candidate) => candidate.event_id === row.event_id,
          ),
        );
        updated.push({ event_id: row.event_id, txid: row.txid });
      }
      return { rows: updated };
    }
    throw new Error(`Unexpected migration fixture query: ${text}`);
  },
};
const firstMigration = await runWorkMarketV2CutoverMigration(migrationClient, {
  apply: true,
});
assert.equal(firstMigration.updatedCount, 2);
assert.equal(firstMigration.alreadyMigratedCount, 0);
assert.equal(firstMigration.pristineCount, 2);
assert.equal(firstMigration.unsupportedV3ProjectionCount, 0);
const secondMigration = await runWorkMarketV2CutoverMigration(migrationClient, {
  apply: true,
});
assert.equal(secondMigration.updatedCount, 0);
assert.equal(secondMigration.alreadyMigratedCount, 2);
assert.equal(secondMigration.pristineCount, 0);
assert.equal(migrationUpdateCalls, 1);
unsupportedProjectionRows = [{ listing_id: "a".repeat(64) }];
await assert.rejects(
  runWorkMarketV2CutoverMigration(migrationClient, { apply: false }),
  /Unsupported WORK Marketplace V2 projections require canonical rebuild/u,
);
unsupportedProjectionRows = [];
assert.equal(
  validateGovernedWorkMarketAction(
    { ...governedBase, oracleBlockHash: "22".repeat(32) },
    {
      actionBlockHeight: 101,
      activationHeight: 101,
      expectedNetworkValueQ8: governedBase.oracleNetworkValueQ8,
      expectedOracleBlockHash: hash,
    },
  ).reasonCode,
  "work-market-v2-oracle-hash-mismatch",
);
assert.equal(
  validateGovernedWorkMarketAction(governedBase, {
    actionBlockHeight: 101,
    activationHeight: 101,
    expectedNetworkValueQ8: governedBase.oracleNetworkValueQ8,
    expectedOracleBlockHash: hash,
  }).valid,
  true,
);
assert.equal(
  validateGovernedWorkMarketAction(
    { ...governedBase, version: "pwt-sale-v2" },
    { actionBlockHeight: 101, activationHeight: 101 },
  ).reasonCode,
  "work-market-v2-version-required",
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
const hydrationIndependentActivation = workMarketV2ActivationForReplay(
  "livenet",
  null,
);
assert.deepEqual(hydrationIndependentActivation, {
  activationHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
  declarationBlockHash: WORK_MARKET_V2_DECLARATION_BLOCK_HASH,
  declarationHeight: WORK_MARKET_V2_DECLARATION_HEIGHT,
  declarationTxid: WORK_MARKET_V2_DECLARATION_TXID,
});
assert.equal(
  validateGovernedWorkMarketAction(
    { ...governedBase, oracleBlockHeight: WORK_MARKET_V2_DECLARATION_HEIGHT },
    {
      actionBlockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
      activationHeight: hydrationIndependentActivation.activationHeight,
    },
  ).reasonCode,
  "work-market-v2-canonical-oracle-unavailable",
);

const apiSource = fs.readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const backfillSource = fs.readFileSync(
  new URL("./backfill-proof-indexer.mjs", import.meta.url),
  "utf8",
);
const readerSource = fs.readFileSync(
  new URL("../server/db/proof-index-reader.mjs", import.meta.url),
  "utf8",
);
const contractSource = fs.readFileSync(
  new URL("../server/work-market-v2.mjs", import.meta.url),
  "utf8",
);
const migrationSource = fs.readFileSync(
  new URL("./migrate-work-market-v2-cutover.mjs", import.meta.url),
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
assert.equal(refundSnapshot.listings.length, 94);
assert.equal(new Set(refundSnapshot.listings.map((row) => row.listingId)).size, 94);
assert.equal(
  refundSnapshot.listings.reduce((sum, row) => sum + row.refundSats, 0),
  refundSnapshot.totals.refundSats,
);
assert.equal(
  refundSnapshot.sellers.reduce((sum, row) => sum + row.refundSats, 0),
  refundSnapshot.totals.refundSats,
);
for (const listing of refundSnapshot.listings) {
  assert.equal(
    listing.refundSats,
    listing.listingMinerFeeSats +
      (listing.sealed
        ? listing.sealMinerFeeSats + listing.sealPaymentSats
        : 0),
  );
  assert.equal(listing.sealPaymentSats, listing.sealed ? 546 : 0);
  assert.ok(["pwt-sale-v1", "pwt-sale-v2"].includes(listing.version));
  assert.doesNotThrow(() => {
    if (listing.sellerAddress.toLowerCase().startsWith("bc1")) {
      const decoded = bitcoin.address.fromBech32(listing.sellerAddress);
      assert.equal(decoded.prefix, "bc");
      return;
    }
    const decoded = bitcoin.address.fromBase58Check(listing.sellerAddress);
    assert.ok([0, 5].includes(decoded.version));
  });
}
const refundListingsBySeller = new Map();
for (const listing of refundSnapshot.listings) {
  const sellerListings =
    refundListingsBySeller.get(listing.sellerAddress) ?? [];
  sellerListings.push(listing);
  refundListingsBySeller.set(listing.sellerAddress, sellerListings);
}
assert.equal(refundListingsBySeller.size, 37);
for (const seller of refundSnapshot.sellers) {
  const listings = refundListingsBySeller.get(seller.sellerAddress) ?? [];
  assert.equal(seller.listingCount, listings.length);
  assert.equal(
    seller.refundSats,
    listings.reduce((total, listing) => total + listing.refundSats, 0),
  );
  assert.deepEqual(
    new Set(seller.listingIds),
    new Set(listings.map((listing) => listing.listingId)),
  );
}
assert.equal(
  refundSnapshot.listings.find(
    (listing) =>
      listing.listingId ===
      "9c79f121eb73f079b330950a2890ba2029416e5b75bafadc642623c66fd963f9",
  )?.refundSats,
  3862,
);

const legacyCutoverListings = refundSnapshot.listings.map((row) => ({
  blockHeight: row.listingBlockHeight,
  confirmed: true,
  listingId: row.listingId,
  network: "livenet",
  saleAuthorization: {
    tokenId: WORK_TOKEN_ID,
    version: row.version,
  },
  tokenId: WORK_TOKEN_ID,
  txid: row.listingId,
}));
const postActivationV1 = {
  ...legacyCutoverListings[0],
  blockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
  listingId: "aa".repeat(32),
  txid: "aa".repeat(32),
};
const postActivationV2 = {
  ...legacyCutoverListings[0],
  blockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT + 1,
  listingId: "bb".repeat(32),
  saleAuthorization: {
    tokenId: WORK_TOKEN_ID,
    version: "pwt-sale-v2",
  },
  txid: "bb".repeat(32),
};
const pendingLegacy = {
  ...legacyCutoverListings[0],
  blockHeight: undefined,
  confirmed: false,
  listingId: "cc".repeat(32),
  txid: "cc".repeat(32),
};
const lateSealListingId =
  "9c79f121eb73f079b330950a2890ba2029416e5b75bafadc642623c66fd963f9";
const lateSealTxid =
  "5575f61bb7f42ef26bf56b1575a8ae43fec54c43a5d3b71057bc8fd4839a1af1";
const cutoverLegacyListings = legacyCutoverListings.map((listing) =>
  listing.listingId === lateSealListingId
    ? {
        ...listing,
        amountSats: 546,
        kind: "token-listing-sealed",
        sealAt: "2026-07-22T02:33:54.000Z",
        sealBlockHash: "22".repeat(32),
        sealBlockHeight: 959091,
        sealConfirmed: true,
        sealMinerFeeSats: 1468,
        sealTxid: lateSealTxid,
      }
    : listing,
);
const v3Listing = {
  ...postActivationV1,
  amountAtoms: "100000000",
  listingId: "dd".repeat(32),
  priceSats: 123,
  saleAuthorization: {
    tokenId: WORK_TOKEN_ID,
    version: WORK_MARKET_V2_AUTH_VERSION,
  },
  txid: "dd".repeat(32),
};
const unknownVersionWorkListing = {
  ...postActivationV1,
  listingId: "de".repeat(32),
  saleAuthorization: {
    tokenId: WORK_TOKEN_ID,
    version: "pwt-sale-v999",
  },
  txid: "de".repeat(32),
};
const missingVersionWorkListing = {
  ...postActivationV1,
  listingId: "df".repeat(32),
  saleAuthorization: {
    tokenId: WORK_TOKEN_ID,
  },
  txid: "df".repeat(32),
};
const nonWorkLegacy = {
  ...postActivationV1,
  listingId: "ee".repeat(32),
  saleAuthorization: {
    tokenId: "ff".repeat(32),
    version: "pwt-sale-v1",
  },
  tokenId: "ff".repeat(32),
  txid: "ee".repeat(32),
};
const alreadyClosedLegacy = {
  ...legacyCutoverListings[0],
  closedTxid: "12".repeat(32),
  listingId: "13".repeat(32),
  status: "sold",
  txid: "13".repeat(32),
};
const cutoverInput = {
  closedListings: [alreadyClosedLegacy],
  collectionHasMore: { listings: true, mints: true },
  hasMore: true,
  indexedThroughBlock: WORK_MARKET_V2_ACTIVATION_HEIGHT,
  invalidEvents: [],
  listings: [
    ...cutoverLegacyListings,
    postActivationV1,
    postActivationV2,
    pendingLegacy,
    v3Listing,
    unknownVersionWorkListing,
    missingVersionWorkListing,
    nonWorkLegacy,
  ],
  network: "livenet",
  stats: {
    activeListings: 99,
    confirmedOpenListings: 98,
    openListings: 99,
    pendingOpenListings: 1,
  },
  summaryOnly: true,
  tokens: [
    {
      confirmedOpenListings: 97,
      lowestAskPricePerToken: 1,
      openListings: 98,
      pendingOpenListings: 1,
      tokenId: WORK_TOKEN_ID,
    },
    {
      confirmedOpenListings: 1,
      lowestAskPricePerToken: 2,
      openListings: 1,
      pendingOpenListings: 0,
      tokenId: nonWorkLegacy.tokenId,
    },
  ],
  totalCounts: { listings: 99, sales: 4 },
};
const cutoverState = applyWorkMarketV2CutoverToTokenState(cutoverInput);
const relicListings = cutoverState.closedListings.filter(
  (listing) => listing.relic === true,
);
assert.equal(relicListings.length, 94);
assert.deepEqual(
  new Set(relicListings.map((listing) => listing.listingId)),
  new Set(refundSnapshot.listings.map((listing) => listing.listingId)),
);
assert.ok(
  relicListings.every(
    (listing) =>
      listing.refundEligible === true &&
      listing.disabledAtBlockHeight === WORK_MARKET_V2_ACTIVATION_HEIGHT &&
      listing.disabledByTxid === WORK_MARKET_V2_DECLARATION_TXID,
  ),
);
assert.deepEqual(
  cutoverState.listings.map((listing) => listing.listingId).sort(),
  [v3Listing.listingId, nonWorkLegacy.listingId].sort(),
);
const cutoverWorkToken = cutoverState.tokens.find(
  (token) => token.tokenId === WORK_TOKEN_ID,
);
assert.equal(cutoverWorkToken.openListings, 1);
assert.equal(cutoverWorkToken.confirmedOpenListings, 1);
assert.equal(cutoverWorkToken.pendingOpenListings, 0);
assert.equal(cutoverWorkToken.lowestAskPricePerToken, 0);
assert.equal(cutoverState.totalCounts.listings, 2);
assert.equal(cutoverState.collectionHasMore.listings, false);
assert.equal(cutoverState.collectionHasMore.mints, true);
assert.equal(cutoverState.hasMore, true);
assert.equal(cutoverState.stats.activeListings, 2);
assert.equal(cutoverState.stats.openListings, 2);
assert.equal(cutoverState.stats.confirmedOpenListings, 2);
assert.equal(cutoverState.stats.pendingOpenListings, 0);
assert.deepEqual(
  cutoverState.invalidEvents
    .map((event) => event.txid)
    .sort(),
  [
    lateSealTxid,
    postActivationV1.listingId,
    postActivationV2.listingId,
    pendingLegacy.listingId,
    unknownVersionWorkListing.listingId,
    missingVersionWorkListing.listingId,
  ].sort(),
);
assert.ok(
  cutoverState.invalidEvents.every(
    (event) => event.refundEligible === false && event.relic === false,
  ),
);
const lateSealRelic = relicListings.find(
  (listing) => listing.listingId === lateSealListingId,
);
assert.equal(lateSealRelic?.sealConfirmed, false);
assert.equal(lateSealRelic?.sealMinerFeeSats, 0);
assert.equal(lateSealRelic?.sealTxid, "");
const lateSealInvalid = cutoverState.invalidEvents.find(
  (event) => event.txid === lateSealTxid,
);
assert.equal(lateSealInvalid?.attemptedKind, "token-listing-sealed");
assert.equal(lateSealInvalid?.blockHeight, 959091);
assert.equal(lateSealInvalid?.listingId, lateSealListingId);
assert.equal(lateSealInvalid?.refundEligible, false);
assert.equal(lateSealInvalid?.auditMinerFeeSats, 1468);
assert.equal(lateSealInvalid?.auditRegistryPaymentSats, 546);
assert.equal(
  refundSnapshot.listings.find(
    (listing) => listing.listingId === lateSealListingId,
  )?.sealed,
  false,
);
assert.equal(cutoverState.closedListings[0].relic, undefined);
assert.equal(cutoverState.closedListings[0].status, "sold");
assert.deepEqual(
  applyWorkMarketV2CutoverToTokenState(cutoverState),
  cutoverState,
);

const beforeActivation = {
  ...cutoverInput,
  indexedThroughBlock: WORK_MARKET_V2_DECLARATION_HEIGHT,
};
assert.equal(
  applyWorkMarketV2CutoverToTokenState(beforeActivation),
  beforeActivation,
);
const testnetState = {
  ...cutoverInput,
  listings: legacyCutoverListings.map((listing) => ({
    ...listing,
    network: "testnet",
  })),
  network: "testnet",
};
assert.equal(applyWorkMarketV2CutoverToTokenState(testnetState), testnetState);

for (const source of [appSource, readerSource, contractSource]) {
  assert.match(source, /pwt-sale-v3/u);
}
assert.match(apiSource, /canonicalWorkMarketV2OraclesForTransactions/u);
assert.match(
  apiSource,
  /const workMarketV2Activation = workMarketV2ActivationForReplay\([\s\S]*network,[\s\S]*declarationTransaction/u,
);
assert.match(apiSource, /workMarketV2OraclesByTxid instanceof Map/u);
assert.match(apiSource, /WORK_MARKET_V2_ORACLE_CACHE/u);
assert.match(
  apiSource,
  /bitcoinRpc\("getblockhash", \[priorHeight\]\)[\s\S]*proofIndexCanonicalSummaryLedgerPayload\([\s\S]*priorHeight,[\s\S]*blockHash/u,
);
assert.doesNotMatch(apiSource, /workMarketV2TargetOracle/u);
assert.match(
  contractSource,
  /work-market-v2-canonical-oracle-unavailable/u,
);
assert.match(
  apiSource,
  /function workActiveListingsFromTransactions[\s\S]*if \(network === "livenet"\) \{[\s\S]*return \[\];/u,
);
for (const functionName of [
  "confirmedWorkSaleFromClosedListingTransaction",
  "recoverWorkSalesFromClosedListings",
  "workTokenStateWithRecoveredListingCloseSales",
  "workTokenStateWithRecoveredListingClosesFromTransactions",
  "workTokenStateWithRecoveredListingSeals",
  "workTokenStateWithRecoveredListingsFromTransactions",
]) {
  assert.match(
    apiSource,
    new RegExp(
      `(?:async )?function ${functionName}\\([\\s\\S]*?if \\(network === "livenet"\\)`,
      "u",
    ),
  );
}
assert.match(
  apiSource,
  /function workTokenDeltaTransactionsWithoutUnverifiedMarketMutations[\s\S]*\["list", "seal", "delist", "buy"\]/u,
);
assert.match(
  apiSource,
  /payload\.workMarketV2Activation\?\.declarationHeight !==[\s\S]*WORK_MARKET_V2_DECLARATION_HEIGHT/u,
);
const workMarketImportEnd = apiSource.indexOf(
  '} from "./work-market-v2.mjs";',
);
const workMarketImportStart = apiSource.lastIndexOf(
  "import {",
  workMarketImportEnd,
);
assert.ok(
  workMarketImportStart >= 0 && workMarketImportEnd > workMarketImportStart,
);
assert.match(
  apiSource.slice(workMarketImportStart, workMarketImportEnd),
  /\bWORK_MARKET_V2_DECLARATION_HEIGHT\b/u,
);
assert.match(apiSource, /deactivateLegacyWorkListingsAtCutover/u);
assert.match(
  apiSource,
  /const refundableLegacy =[\s\S]*TOKEN_SALE_AUTH_VERSION, TOKEN_SALE_AUTH_ATOMS_VERSION/u,
);
assert.match(apiSource, /work-market-v2-cutover/u);
assert.match(appSource, /assertWorkMarketV2DeclarationConfirmed/u);
assert.match(appSource, /This WORK listing is below the current network value/u);
assert.match(
  appSource,
  /WORK Marketplace V2 purchases are next-block bound[\s\S]*seller payment and sale-ticket spend can still confirm while the WORK transfer is rejected/u,
);
assert.match(
  appSource,
  /const preBroadcastFloor = await fetchWorkFloorQuote\("livenet", true\)[\s\S]*preBroadcastPricingFields\.oracleBlockHeight !==[\s\S]*purchaseAuthorization\.oracleBlockHeight[\s\S]*WORK pricing tip advanced before signing/u,
);
assert.match(
  appSource,
  /function listingAnchorDetails[\s\S]*TOKEN_SALE_AUTH_WORK_MARKET_V2_VERSION[\s\S]*tokenSaleAuthorizationUsesSpendableSaleTicketAnchor/u,
);
assert.match(
  appSource,
  /WORK uses the network value as a hard on-chain floor/u,
);
assert.match(appSource, /Marketplace V1 Relic/u);
assert.match(appSource, /disabledAtBlockHeight: 959062/u);
assert.match(
  appSource,
  /import workMarketV1RefundSnapshot from "\.\.\/WORK_MARKET_V1_REFUNDS_959061\.json"/u,
);
assert.match(
  appSource,
  /function workMarketV1RelicRows\([\s\S]*workMarketV1RefundSnapshot\.listings[\s\S]*snapshotById[\s\S]*serverListingById\.get\(refund\.listingId\)/u,
);
assert.match(appSource, /workRelicRows\.length\.toLocaleString\(\)/u);
assert.match(appSource, /refund\.refundSats\.toLocaleString\(\)/u);
const relicViewStart = appSource.indexOf(
  'selectedMarketTokenIsWork && workMarketplaceVersion === "v1-relic"',
);
const relicViewEnd = appSource.indexOf(
  '\n        ) : (\n        <section className="id-card token-market-card">',
  relicViewStart,
);
assert.ok(relicViewStart >= 0 && relicViewEnd > relicViewStart);
const relicViewSource = appSource.slice(relicViewStart, relicViewEnd);
assert.doesNotMatch(relicViewSource, /buyListing|sealTokenListing|onClick=/u);
assert.match(readerSource, /'pwt-sale-v3'/u);
assert.match(
  readerSource,
  /listing_tx\.block_height AS listing_block_height/u,
);
assert.match(
  readerSource,
  /function tokenHistoryPageFromSnapshot[\s\S]*applyWorkMarketV2CutoverToTokenState/u,
);
assert.match(
  readerSource,
  /function exactActiveTokenListingHistoryPage[\s\S]*WORK_MARKET_V2_ACTIVATION_HEIGHT[\s\S]*pwt-sale-v3/u,
);
assert.match(
  readerSource,
  /lower\(COALESCE\(cl\.token_id, ''\)\) <> \$\{workTokenParam\}[\s\S]*saleAuthorization'->>'version',[\s\S]*''[\s\S]*\)\) = 'pwt-sale-v3'/u,
);
assert.ok(
  [...readerSource.matchAll(/= 'pwt-sale-v3'/gu)].length >= 2,
  "exact and broad active WORK listing reads must require V3",
);
assert.match(
  readerSource,
  /\["listings", "market-log"\]\.includes\(eligibility\.kind\)[\s\S]*authoritativeEmpty: true[\s\S]*indexed_through_block: scan\?\.indexed_through_block/u,
);
assert.match(
  readerSource,
  /totalCount === 0[\s\S]*queryDisposition !== "terminal-nonmarket"[\s\S]*options\.authoritativeEmpty !== true/u,
);
assert.ok(
  [...readerSource.matchAll(/applyWorkMarketV2CutoverToTokenState\(/gu)]
    .length >= 5,
);
assert.match(
  apiSource,
  /function tokenMarketLifecycleOverlayFromCreditListings[\s\S]*applyWorkMarketV2CutoverToTokenState/u,
);
assert.match(
  apiSource,
  /function tokenStateWithIndexedMarketSummaryOverlay[\s\S]*applyWorkMarketV2CutoverToTokenState/u,
);
assert.doesNotMatch(apiSource, /workMarketV2CutoverApplied/u);
assert.match(migrationSource, /WORK_MARKET_V2_CUTOVER_APPLY === "1"/u);
assert.match(
  migrationSource,
  /5575f61bb7f42ef26bf56b1575a8ae43fec54c43a5d3b71057bc8fd4839a1af1/u,
);
assert.match(
  migrationSource,
  /df317cbbfdc603a390ee0f8b027ba8f0d08ef2200ce914b0b3e7dd46ce0982ce/u,
);
assert.match(
  migrationSource,
  /row\.kind !== target\.kind[\s\S]*Number\(row\.block_height\) !== target\.blockHeight[\s\S]*row\.version !== target\.version/u,
);
assert.match(migrationSource, /await client\.query\("ROLLBACK"\)/u);
assert.match(migrationSource, /classifyWorkMarketV2CutoverRows/u);
assert.match(migrationSource, /event_id = ANY\(\$1::bigint\[\]\)/u);
assert.match(migrationSource, /alreadyMigratedCount/u);
assert.match(
  backfillSource,
  /const saleAuthorization = decodeBase64UrlJson\(parts\[4\]\)/u,
);
assert.match(
  backfillSource,
  /proof_indexer\.events action_event[\s\S]*saleAuthorization'->>'oracleBlockHeight'[\s\S]*saleAuthorization'->>'oracleBlockHash'/u,
);
assert.ok(
  [
    ...backfillSource.matchAll(
      /oracle_snapshot\.snapshot_id = EXCLUDED\.snapshot_id/gu,
    ),
  ].length >= 2,
);

console.log("WORK Marketplace V2 pricing contract passed.");
