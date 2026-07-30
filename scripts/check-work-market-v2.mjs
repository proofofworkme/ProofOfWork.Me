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
  WORK_MARKET_V4_AUTH_VERSION,
  WORK_MARKET_V4_DECLARATION_AUTHORITY,
  WORK_MARKET_V4_DECLARATION_MEMO,
  WORK_MARKET_V4_DECLARATION_MIN_PAYMENT_SATS,
  WORK_MARKET_V4_DECLARATION_PAYLOAD,
  WORK_MARKET_V4_DECLARATION_REGISTRY_ADDRESS,
  WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS,
  WORK_MARKET_V4_ORACLE_MODEL,
  validateGovernedWorkMarketAction,
  validateWorkMarketV2Authorization,
  validateWorkMarketV4Authorization,
  workMarketV2ActivationFromDeclaration,
  workMarketV2ActivationForReplay,
  workMarketV4ActivationReached,
  workMarketCachedOracleContext,
  workMarketV2MinimumPriceSats,
  workMarketOracleActionKey,
  workMarketOracleCacheKey,
  workMarketV4QuoteHeightWithinBound,
  workMarketplaceBroadcastDecision,
  workMarketplaceWriteActionIsGoverned,
} from "../server/work-market-v2.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";
import {
  tokenListingCanProjectCloseActivity,
  tokenListingTransactionCanProjectActive,
} from "../server/token-listing-lifecycle.mjs";
import {
  WORK_AMO_V5_ALLOWED_FACE_USD_CENTS,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_UNIT_MODEL,
} from "../server/work-amo-v5.mjs";

const hash = "11".repeat(32);
assert.notEqual(
  WORK_AMO_V5_AUTH_VERSION,
  WORK_MARKET_V4_AUTH_VERSION,
  "AMO V5 must remain a separate authorization from immutable V4 history",
);
assert.deepEqual(
  WORK_AMO_V5_ALLOWED_FACE_USD_CENTS,
  [2_000, 5_000, 10_000],
);
assert.equal(WORK_AMO_V5_UNIT_MODEL, "canonical-work-amo-usd-unit-v2");
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

const confirmationHash = "22".repeat(32);
const v4Base = {
  ...governedBase,
  oracleBlockHeight: 100,
  oracleModel: WORK_MARKET_V4_ORACLE_MODEL,
  priceSats: 2,
  version: WORK_MARKET_V4_AUTH_VERSION,
};
for (const action of ["list5", "seal5", "buy5"]) {
  const validation = validateWorkMarketV4Authorization(v4Base, {
    actionBlockHeight: 103,
    expectedConfirmationNetworkValueQ8: "4200000000000000",
    expectedConfirmationOracleBlockHash: confirmationHash,
    expectedQuoteNetworkValueQ8: v4Base.oracleNetworkValueQ8,
    expectedQuoteOracleBlockHash: hash,
  });
  assert.equal(validation.valid, true, `${action} must allow a historical quote`);
  assert.equal(validation.confirmationOracleBlockHeight, 102);
  assert.equal(validation.confirmationMinimumPriceSats, "2");
}
const belowConfirmationFloor = validateWorkMarketV4Authorization(v4Base, {
  actionBlockHeight: 103,
  expectedConfirmationNetworkValueQ8: "4200000000000001",
  expectedConfirmationOracleBlockHash: confirmationHash,
  expectedQuoteNetworkValueQ8: v4Base.oracleNetworkValueQ8,
  expectedQuoteOracleBlockHash: hash,
});
assert.equal(
  belowConfirmationFloor.reasonCode,
  "work-market-v4-below-confirmation-floor",
);
assert.equal(belowConfirmationFloor.confirmationOracleBlockHeight, 102);
assert.equal(
  belowConfirmationFloor.confirmationOracleBlockHash,
  confirmationHash,
);
assert.equal(
  belowConfirmationFloor.confirmationOracleNetworkValueQ8,
  "4200000000000001",
);
assert.equal(
  validateWorkMarketV4Authorization(v4Base, {
    actionBlockHeight: 103,
    expectedConfirmationNetworkValueQ8: "4200000000000000",
    expectedConfirmationOracleBlockHash: confirmationHash,
    expectedQuoteNetworkValueQ8: v4Base.oracleNetworkValueQ8,
    expectedQuoteOracleBlockHash: "33".repeat(32),
  }).reasonCode,
  "work-market-v4-oracle-hash-mismatch",
);
assert.equal(
  validateWorkMarketV4Authorization(
    {
      ...v4Base,
      oracleBlockHeight: 1_000,
    },
    {
      actionBlockHeight: 1_000 + WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS,
      expectedConfirmationNetworkValueQ8: "4200000000000000",
      expectedConfirmationOracleBlockHash: confirmationHash,
      expectedQuoteNetworkValueQ8: v4Base.oracleNetworkValueQ8,
      expectedQuoteOracleBlockHash: hash,
    },
  ).valid,
  true,
);
assert.equal(
  validateWorkMarketV4Authorization(
    {
      ...v4Base,
      oracleBlockHeight: 1_000,
    },
    {
      actionBlockHeight: 1_001 + WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS,
      expectedConfirmationNetworkValueQ8: "4200000000000000",
      expectedConfirmationOracleBlockHash: confirmationHash,
      expectedQuoteNetworkValueQ8: v4Base.oracleNetworkValueQ8,
      expectedQuoteOracleBlockHash: hash,
    },
  ).reasonCode,
  "work-market-v4-quote-expired",
);
assert.equal(
  workMarketV4QuoteHeightWithinBound(
    1_000 + WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS,
    1_000,
  ),
  true,
);
assert.equal(
  workMarketV4QuoteHeightWithinBound(
    1_001 + WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS,
    1_000,
  ),
  false,
);
const retentionTipHeight = 10_000;
const duplicateCanonicalSummaryHeights = Array.from(
  { length: 600 },
  (_, offset) => retentionTipHeight - offset,
).flatMap((height) => [height, height, height]);
const retainedCanonicalSummaryHeights = new Set(
  [...new Set(duplicateCanonicalSummaryHeights)]
    .sort((left, right) => right - left)
    .slice(0, 512),
);
assert.equal(
  retainedCanonicalSummaryHeights.has(
    retentionTipHeight - WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS,
  ),
  true,
  "the 480-block quote boundary must survive 512 distinct-height retention",
);

const validBroadcastAction = (action) => ({
  action,
  authVersion: WORK_MARKET_V4_AUTH_VERSION,
  canonicalParsed: true,
  paysWorkRegistry: true,
  registryAddress: WORK_MARKET_V4_DECLARATION_REGISTRY_ADDRESS,
  signedShapeValid: true,
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  tokenProtocolMessageCount: 1,
});

assert.deepEqual(
  workMarketplaceBroadcastDecision(
    [{ action: "list5", authVersion: WORK_MARKET_V4_AUTH_VERSION }],
    { metadata: { writesEnabled: false }, network: "livenet" },
  ),
  {
    allowed: false,
    code: "WORK_MARKETPLACE_WRITES_PAUSED",
    statusCode: 503,
  },
);
assert.deepEqual(
  workMarketplaceBroadcastDecision(
    [{ action: "seal5", authVersion: WORK_MARKET_V2_AUTH_VERSION }],
    { metadata: { writesEnabled: true }, network: "livenet" },
  ),
  {
    allowed: false,
    code: "WORK_MARKETPLACE_V4_REQUIRED",
    statusCode: 400,
  },
);
assert.equal(
  workMarketplaceBroadcastDecision(
    [validBroadcastAction("buy5")],
    { metadata: { writesEnabled: true }, network: "livenet" },
  ).allowed,
  true,
);
assert.equal(
  workMarketplaceBroadcastDecision(
    [{ action: "send2", authVersion: "" }],
    { metadata: { writesEnabled: false }, network: "testnet" },
  ).allowed,
  true,
);
for (const gateway of ["node", "slipstream"]) {
  for (const action of ["list5", "seal5", "buy5"]) {
    const forgedTokenAction = {
      action,
      tokenId: "ff".repeat(32),
    };
    assert.equal(
      workMarketplaceWriteActionIsGoverned(forgedTokenAction, {
        paysWorkRegistry: true,
      }),
      true,
      `${gateway} must govern ${action} when it pays the WORK registry even if tokenId is forged`,
    );
    assert.equal(
      workMarketplaceBroadcastDecision(
        [{
          action,
          authVersion: WORK_MARKET_V4_AUTH_VERSION,
        }],
        { metadata: { writesEnabled: false }, network: "livenet" },
      ).code,
      "WORK_MARKETPLACE_WRITES_PAUSED",
      `${gateway} must pause the forged-tokenId ${action}`,
    );
    assert.equal(
      workMarketplaceBroadcastDecision(
        [{
          action,
          authVersion: WORK_MARKET_V4_AUTH_VERSION,
          canonicalParsed: false,
        }],
        { metadata: { writesEnabled: true }, network: "livenet" },
      ).code,
      "WORK_MARKETPLACE_V4_REQUIRED",
      `${gateway} must reject raw or malformed claimed-V4 ${action}`,
    );
    assert.equal(
      validateWorkMarketV4Authorization(
        {
          ...v4Base,
          oracleBlockHeight: 1_000,
        },
        {
          actionBlockHeight:
            1_001 + WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS,
          expectedConfirmationNetworkValueQ8: "4200000000000000",
          expectedConfirmationOracleBlockHash: confirmationHash,
          expectedQuoteNetworkValueQ8: v4Base.oracleNetworkValueQ8,
          expectedQuoteOracleBlockHash: hash,
        },
      ).reasonCode,
      "work-market-v4-quote-expired",
      `${gateway} must reject a stale V4 quote at admission`,
    );
    assert.equal(
      workMarketplaceWriteActionIsGoverned(forgedTokenAction, {
        paysWorkRegistry: false,
      }),
      false,
      `${gateway} must not treat a post-protocol WORK payment as admission evidence`,
    );
    assert.equal(
      workMarketplaceBroadcastDecision(
        [{ ...validBroadcastAction(action), paysWorkRegistry: false }],
        { metadata: { writesEnabled: true }, network: "livenet" },
      ).code,
      "WORK_MARKETPLACE_V4_TRANSACTION_INVALID",
      `${gateway} must reject ${action} without a pre-protocol WORK registry payment`,
    );
    assert.equal(
      workMarketplaceBroadcastDecision(
        [
          {
            ...validBroadcastAction(action),
            registryAddress: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
          },
        ],
        { metadata: { writesEnabled: true }, network: "livenet" },
      ).code,
      "WORK_MARKETPLACE_V4_TRANSACTION_INVALID",
      `${gateway} must reject ${action} with noncanonical WORK terms`,
    );
    assert.equal(
      workMarketplaceBroadcastDecision(
        [{ ...validBroadcastAction(action), signedShapeValid: false }],
        { metadata: { writesEnabled: true }, network: "livenet" },
      ).code,
      "WORK_MARKETPLACE_V4_TRANSACTION_INVALID",
      `${gateway} must reject ${action} with the wrong sale-ticket shape`,
    );
    assert.equal(
      workMarketplaceBroadcastDecision(
        [{ ...validBroadcastAction(action), tokenProtocolMessageCount: 2 }],
        { metadata: { writesEnabled: true }, network: "livenet" },
      ).code,
      "WORK_MARKETPLACE_V4_TRANSACTION_INVALID",
      `${gateway} must reject a multi-mutation transaction that could reuse one registry fee`,
    );
  }
}
assert.equal(
  workMarketplaceWriteActionIsGoverned(
    { action: "buy5", tokenId: "ff".repeat(32) },
    { paysWorkRegistry: false },
  ),
  false,
);
assert.equal(
  workMarketplaceWriteActionIsGoverned(
    { action: "delist5", tokenId: WORK_TOKEN_ID },
    { paysWorkRegistry: true },
  ),
  false,
);

const sameBlockActionA = {
  authorization: v4Base,
  blockHash: confirmationHash,
  blockHeight: 103,
  protocolVout: 2,
  txid: "44".repeat(32),
};
const sameBlockActionB = {
  ...sameBlockActionA,
  authorization: { ...v4Base, oracleBlockHeight: 101 },
  protocolVout: 3,
  txid: "55".repeat(32),
};
assert.notEqual(
  workMarketOracleCacheKey(sameBlockActionA, "livenet"),
  workMarketOracleCacheKey(sameBlockActionB, "livenet"),
);
assert.notEqual(
  workMarketOracleActionKey(sameBlockActionA.txid, 2),
  workMarketOracleActionKey(sameBlockActionA.txid, 3),
);
const oracleCache = new Map([
  [
    workMarketOracleCacheKey(sameBlockActionA, "livenet"),
    {
      confirmationOracle: { blockHeight: 102, marker: "confirmation-a" },
      quoteOracle: { blockHeight: 100, marker: "quote-a" },
    },
  ],
  [
    workMarketOracleCacheKey(sameBlockActionB, "livenet"),
    {
      confirmationOracle: { blockHeight: 102, marker: "confirmation-b" },
      quoteOracle: { blockHeight: 101, marker: "quote-b" },
    },
  ],
]);
for (let replay = 0; replay < 2; replay += 1) {
  assert.equal(
    workMarketCachedOracleContext(
      oracleCache,
      sameBlockActionA,
      "livenet",
    )?.quoteOracle?.marker,
    "quote-a",
  );
  assert.equal(
    workMarketCachedOracleContext(
      oracleCache,
      sameBlockActionB,
      "livenet",
    )?.quoteOracle?.marker,
    "quote-b",
  );
}

const declarationMemoChunks =
  WORK_MARKET_V4_DECLARATION_MEMO.match(/[\s\S]{1,240}/gu) ?? [];
const declarationPayloads = declarationMemoChunks.map(
  (chunk) => `pwm1:m:${chunk}`,
);
assert.equal(
  declarationPayloads
    .map((payload) => payload.slice("pwm1:m:".length))
    .join(""),
  WORK_MARKET_V4_DECLARATION_MEMO,
);
const declarationCarrierScripts = declarationPayloads.map(
  (payload) =>
    bitcoin.payments.embed({ data: [Buffer.from(payload, "utf8")] }).output,
);
assert.ok(declarationCarrierScripts.every((script) => script.length < 100_000));
assert.ok(
  declarationCarrierScripts.reduce(
    (total, script) => total + script.length,
    0,
  ) < 100_000,
);

const v4TestEnvironment = {
  WORK_MARKET_V4_DECLARATION_BLOCK_HASH: "66".repeat(32),
  WORK_MARKET_V4_DECLARATION_HEIGHT: "1000000",
  WORK_MARKET_V4_DECLARATION_TXID: "77".repeat(32),
};
const priorV4Environment = Object.fromEntries(
  Object.keys(v4TestEnvironment).map((key) => [key, process.env[key]]),
);
for (const key of Object.keys(v4TestEnvironment)) {
  delete process.env[key];
}
const discoveryContractUrl = new URL(
  "../server/work-market-v2.mjs",
  import.meta.url,
);
discoveryContractUrl.searchParams.set(
  "v4-discovery-regression",
  `${Date.now()}-${Math.random()}`,
);
const discoveryContract = await import(discoveryContractUrl.href);
const discoveryEvidence = {
  blockHash: "55".repeat(32),
  blockHeight: 1_000_000,
  confirmed: true,
  firstInputAddress: WORK_MARKET_V4_DECLARATION_AUTHORITY,
  payload: WORK_MARKET_V4_DECLARATION_PAYLOAD,
  registryPaymentSats: WORK_MARKET_V4_DECLARATION_MIN_PAYMENT_SATS,
  txid: "44".repeat(32),
};
const discoveredActivation =
  discoveryContract.workMarketV4ActivationFromDeclaration(
    discoveryEvidence,
  );
assert.deepEqual(discoveredActivation, {
  activationHeight: 1_000_001,
  declarationBlockHash: "55".repeat(32),
  declarationHeight: 1_000_000,
  declarationTxid: "44".repeat(32),
});
const discoveryV3Listing = {
  blockHeight: 999_999,
  confirmed: true,
  listingId: "aa".repeat(32),
  network: "livenet",
  saleAuthorization: {
    tokenId: WORK_TOKEN_ID,
    version: WORK_MARKET_V2_AUTH_VERSION,
  },
  tokenId: WORK_TOKEN_ID,
  txid: "aa".repeat(32),
};
assert.equal(
  discoveryContract.applyWorkMarketV2CutoverToTokenState({
    closedListings: [],
    indexedThroughBlock: 1_000_000,
    invalidEvents: [],
    listings: [discoveryV3Listing],
    network: "livenet",
    workMarketV4Activation: discoveredActivation,
  }).listings.length,
  1,
  "the declaration block D must remain V3",
);
const discoveredDPlusOneState =
  discoveryContract.applyWorkMarketV2CutoverToTokenState({
    closedListings: [],
    indexedThroughBlock: 1_000_001,
    invalidEvents: [],
    listings: [discoveryV3Listing],
    network: "livenet",
    workMarketV4Activation: discoveredActivation,
  });
assert.equal(
  discoveredDPlusOneState.listings.length,
  0,
  "chain-discovered declaration evidence must activate at D+1 before pins exist",
);
assert.equal(discoveredDPlusOneState.closedListings[0]?.relic, true);
assert.equal(
  discoveredDPlusOneState.closedListings[0]?.disabledAtBlockHeight,
  1_000_001,
);
Object.assign(process.env, v4TestEnvironment);
try {
  const configuredContractUrl = new URL(
    "../server/work-market-v2.mjs",
    import.meta.url,
  );
  configuredContractUrl.searchParams.set(
    "v4-regression",
    `${Date.now()}-${Math.random()}`,
  );
  const configuredContract = await import(configuredContractUrl.href);
  const reconstructedDeclarationPayload = `pwm1:m:${declarationPayloads
    .map((payload) => payload.slice("pwm1:m:".length))
    .join("")}`;
  const coreShapedHeight =
    configuredContract.workMarketV4DeclarationCanonicalHeight({
      blockHash: v4TestEnvironment.WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
      canonicalBlockHash:
        v4TestEnvironment.WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
    });
  assert.equal(coreShapedHeight, 1_000_000);
  assert.equal(
    configuredContract.workMarketV4DeclarationCanonicalHeight({
      blockHash: v4TestEnvironment.WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
      canonicalBlockHash: "88".repeat(32),
    }),
    0,
  );
  const declarationEvidence = {
    blockHash: v4TestEnvironment.WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
    blockHeight: coreShapedHeight,
    confirmed: true,
    firstInputAddress: WORK_MARKET_V4_DECLARATION_AUTHORITY,
    payload: reconstructedDeclarationPayload,
    registryPaymentSats: WORK_MARKET_V4_DECLARATION_MIN_PAYMENT_SATS,
    txid: v4TestEnvironment.WORK_MARKET_V4_DECLARATION_TXID,
  };
  const verifiedActivation =
    configuredContract.workMarketV4ActivationFromDeclaration(
      declarationEvidence,
    );
  assert.deepEqual(verifiedActivation, {
    activationHeight: 1_000_001,
    declarationBlockHash:
      v4TestEnvironment.WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
    declarationHeight: 1_000_000,
    declarationTxid: v4TestEnvironment.WORK_MARKET_V4_DECLARATION_TXID,
  });
  assert.equal(workMarketV4ActivationReached(verifiedActivation, 1_000_000), false);
  assert.equal(workMarketV4ActivationReached(verifiedActivation, 1_000_001), true);
  assert.deepEqual(
    configuredContract.workMarketplaceV4StatusFromEvidence(
      declarationEvidence,
      { tipHeight: 1_000_001, writesConfigured: true },
    ),
    {
      active: true,
      activationHeight: 1_000_001,
      authVersion: WORK_MARKET_V4_AUTH_VERSION,
      declarationBlockHash:
        v4TestEnvironment.WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
      declarationConfirmed: true,
      declarationHeight: 1_000_000,
      declarationTxid: v4TestEnvironment.WORK_MARKET_V4_DECLARATION_TXID,
      oracleModel: WORK_MARKET_V4_ORACLE_MODEL,
      writesEnabled: true,
    },
  );
  for (const unavailableOrPoisonedEvidence of [
    null,
    { ...declarationEvidence, txid: "88".repeat(32) },
    { ...declarationEvidence, payload: `${WORK_MARKET_V4_DECLARATION_PAYLOAD}!` },
    { ...declarationEvidence, firstInputAddress: "external-cache-poison" },
  ]) {
    const status = configuredContract.workMarketplaceV4StatusFromEvidence(
      unavailableOrPoisonedEvidence,
      { tipHeight: 1_000_001, writesConfigured: true },
    );
    assert.equal(status.active, false);
    assert.equal(status.declarationConfirmed, false);
    assert.equal(status.writesEnabled, false);
  }
  assert.equal(
    configuredContract.workMarketplaceV4StatusFromEvidence(
      declarationEvidence,
      { tipHeight: null, writesConfigured: true },
    ).writesEnabled,
    false,
    "Core tip unavailability must keep writes disabled",
  );
  for (const alteredEvidence of [
    null,
    { ...declarationEvidence, confirmed: false },
    { ...declarationEvidence, firstInputAddress: "wrong" },
    { ...declarationEvidence, payload: `${WORK_MARKET_V4_DECLARATION_PAYLOAD}!` },
    {
      ...declarationEvidence,
      registryPaymentSats: WORK_MARKET_V4_DECLARATION_MIN_PAYMENT_SATS - 1,
    },
    { ...declarationEvidence, blockHash: "99".repeat(32) },
  ]) {
    assert.equal(
      configuredContract.workMarketV4ActivationFromDeclaration(
        alteredEvidence,
      ),
      null,
    );
  }

  const configuredV3Listing = {
    blockHeight: 999_999,
    confirmed: true,
    listingId: "aa".repeat(32),
    network: "livenet",
    saleAuthorization: {
      tokenId: WORK_TOKEN_ID,
      version: WORK_MARKET_V2_AUTH_VERSION,
    },
    tokenId: WORK_TOKEN_ID,
    txid: "aa".repeat(32),
  };
  const configuredCutoverState = {
    closedListings: [],
    indexedThroughBlock: 1_000_001,
    invalidEvents: [],
    listings: [configuredV3Listing],
    network: "livenet",
  };
  assert.equal(
    configuredContract.applyWorkMarketV2CutoverToTokenState(
      configuredCutoverState,
    ).listings.length,
    1,
    "configured but missing declaration evidence must keep V3 active",
  );
  assert.equal(
    configuredContract.applyWorkMarketV2CutoverToTokenState({
      ...configuredCutoverState,
      workMarketV4Activation: {
        ...verifiedActivation,
        declarationBlockHash: "bb".repeat(32),
      },
    }).listings.length,
    1,
    "reorged declaration evidence must keep V3 active",
  );
  const verifiedCutover =
    configuredContract.applyWorkMarketV2CutoverToTokenState({
      ...configuredCutoverState,
      workMarketV4Activation: verifiedActivation,
    });
  assert.equal(verifiedCutover.listings.length, 0);
  assert.equal(verifiedCutover.closedListings.length, 1);
  assert.equal(verifiedCutover.closedListings[0].relic, true);
  assert.equal(verifiedCutover.closedListings[0].refundEligible, false);
} finally {
  for (const [key, value] of Object.entries(priorV4Environment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

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
const snapshotExcludedLegacy = {
  ...legacyCutoverListings[0],
  listingId:
    "551cb9020def00e9ad5735d4b475d563f2099a0fe593be0b93eeb24d685a1a24",
  txid:
    "551cb9020def00e9ad5735d4b475d563f2099a0fe593be0b93eeb24d685a1a24",
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
    snapshotExcludedLegacy,
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
const snapshotExcludedClosed = cutoverState.closedListings.find(
  (listing) => listing.listingId === snapshotExcludedLegacy.listingId,
);
assert.equal(snapshotExcludedClosed?.status, "closed");
assert.equal(snapshotExcludedClosed?.relic, false);
assert.equal(snapshotExcludedClosed?.refundEligible, false);
assert.equal(
  snapshotExcludedClosed?.disabledReason,
  "work-market-v1-refund-snapshot-excluded",
);
const sanitizedResurfacedRelic = applyWorkMarketV2CutoverToTokenState({
  closedListings: [
    {
      ...snapshotExcludedLegacy,
      disabledReason: "",
      refundEligible: true,
      relic: true,
      status: "disabled",
    },
  ],
  indexedThroughBlock: WORK_MARKET_V2_ACTIVATION_HEIGHT,
  invalidEvents: [],
  listings: [],
  network: "livenet",
}).closedListings[0];
assert.equal(sanitizedResurfacedRelic.status, "closed");
assert.equal(sanitizedResurfacedRelic.relic, false);
assert.equal(sanitizedResurfacedRelic.refundEligible, false);
assert.equal(
  sanitizedResurfacedRelic.disabledReason,
  "work-market-v1-refund-snapshot-excluded",
);
assert.equal(
  tokenListingCanProjectCloseActivity(snapshotExcludedClosed),
  false,
);
assert.equal(tokenListingTransactionCanProjectActive("confirmed"), true);
assert.equal(tokenListingTransactionCanProjectActive("pending"), true);
assert.equal(tokenListingTransactionCanProjectActive("dropped"), false);
assert.equal(tokenListingTransactionCanProjectActive("orphaned"), false);
assert.equal(
  tokenListingCanProjectCloseActivity({
    closedConfirmed: false,
    closedTxid: "a3".repeat(32),
  }),
  false,
);
assert.equal(
  tokenListingCanProjectCloseActivity({
    closedConfirmed: true,
    closedTxid: "",
  }),
  false,
);
assert.equal(
  tokenListingCanProjectCloseActivity({
    closedConfirmed: true,
    closedTxid: "a3".repeat(32),
  }),
  true,
);
const recoveredSnapshotListing = legacyCutoverListings.find(
  (listing) =>
    listing.listingId ===
    "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa",
);
assert.ok(recoveredSnapshotListing);
const recoveredSnapshotRelic = applyWorkMarketV2CutoverToTokenState({
  closedListings: [
    {
      ...recoveredSnapshotListing,
      closeTxid: "a4".repeat(32),
      closedTxid: "a4".repeat(32),
      refundEligible: undefined,
      relic: undefined,
      sealBlockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT + 3,
      sealConfirmed: true,
      sealTxid: "b4".repeat(32),
      status: "closed",
    },
  ],
  indexedThroughBlock: WORK_MARKET_V2_ACTIVATION_HEIGHT + 10,
  invalidEvents: [],
  listings: [],
  network: "livenet",
}).closedListings[0];
assert.equal(recoveredSnapshotRelic.status, "disabled");
assert.equal(recoveredSnapshotRelic.relic, true);
assert.equal(recoveredSnapshotRelic.refundEligible, true);
assert.equal(recoveredSnapshotRelic.closeTxid, "a4".repeat(32));
assert.equal(recoveredSnapshotRelic.closedTxid, "a4".repeat(32));
assert.equal(recoveredSnapshotRelic.sealConfirmed, false);
assert.equal(recoveredSnapshotRelic.sealTxid, "");
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

for (const source of [appSource, contractSource]) {
  assert.match(source, /pwt-sale-v3/u);
  assert.match(source, /pwt-sale-v4/u);
}
assert.match(readerSource, /WORK_MARKET_V2_AUTH_VERSION/u);
assert.match(readerSource, /WORK_MARKET_V4_AUTH_VERSION/u);
assert.match(apiSource, /canonicalWorkMarketV2OraclesForTransactions/u);
assert.match(
  apiSource,
  /const workMarketV2Activation = workMarketV2ActivationForReplay\([\s\S]*network,[\s\S]*declarationTransaction/u,
);
assert.match(apiSource, /workMarketV2OraclesByTxid instanceof Map/u);
assert.match(apiSource, /WORK_MARKET_V2_ORACLE_CACHE/u);
assert.match(apiSource, /workMarketCachedOracleContext/u);
assert.match(apiSource, /workMarketOracleActionKey\(txid, protocolVout\)/u);
assert.match(
  apiSource,
  /for \(let protocolVout = 0; protocolVout < vout\.length; protocolVout \+= 1\)/u,
);
assert.match(
  apiSource,
  /bitcoinRpc\("getblockhash", \[priorHeight\]\)[\s\S]*proofIndexCanonicalSummaryLedgerPayload\([\s\S]*priorHeight,[\s\S]*blockHash/u,
);
assert.doesNotMatch(apiSource, /workMarketV2TargetOracle/u);
assert.match(
  contractSource,
  /work-market-v2-canonical-oracle-unavailable/u,
);
assert.match(contractSource, /work-market-v4-below-confirmation-floor/u);
assert.match(
  contractSource,
  /confirmationOracleBlockHeight: actionHeight - 1/u,
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
assert.match(
  appSource,
  /function workAmoV6ActivationReady[\s\S]*status\?\.version === TOKEN_SALE_AUTH_WORK_AMO_PROOF_UNIT_VERSION[\s\S]*status\.activation\?\.active === true[\s\S]*status\.activation\.evidenceComplete === true/u,
);
assert.match(
  appSource,
  /function workAmoV6SettlementWritesReady[\s\S]*status\?\.ready === true[\s\S]*status\.protocolWritesEnabled === true[\s\S]*status\.settlementWritesEnabled === true/u,
);
assert.match(
  appSource,
  /function workAmoV6ListingWritesReady[\s\S]*workAmoV6SettlementWritesReady\(quote\)[\s\S]*status\?\.listingWritesEnabled === true/u,
);
assert.match(appSource, /function assertWorkAmoV6SettlementEnabled/u);
assert.match(appSource, /function assertWorkAmoV6ListingEnabled/u);
assert.match(appSource, /TOKEN_SALE_AUTH_WORK_CONFIRMATION_FLOOR_VERSION/u);
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
  /async function verifiedWorkMarketV4Activation[\s\S]*declaration_block\.canonical = true[\s\S]*workMarketV4ActivationFromDeclaration/u,
);
assert.match(
  readerSource,
  /function canonicalWorkMarketV3ListingProjectionSql/u,
);
assert.match(
  readerSource,
  /payloadWithVerifiedWorkMarketV4Activation/u,
);
assert.match(
  readerSource,
  /\["listings", "closedListings", "market-log"\]\.includes\(eligibility\.kind\)[\s\S]*authoritativeEmpty: true[\s\S]*indexed_through_block: scan\?\.indexed_through_block/u,
);
assert.match(
  readerSource,
  /totalCount === 0[\s\S]*!queryDisposition\.startsWith\("terminal-"\)[\s\S]*options\.authoritativeEmpty !== true/u,
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
assert.match(
  apiSource,
  /function workMarketplaceV4Metadata[\s\S]*workMarketV4DeclarationCanonicalHeight[\s\S]*workMarketV4ActivationFromDeclaration/u,
);
assert.match(
  apiSource,
  /function signedWorkMarketplaceWriteActions[\s\S]*workMarketplaceWriteActionIsGoverned\([\s\S]*\{ paysWorkRegistry \}/u,
);
assert.match(
  apiSource,
  /async function broadcastSlipstreamPayload[\s\S]*assertWorkMarketplaceBroadcastAllowed/u,
);
assert.match(
  apiSource,
  /async function broadcastNodePayload[\s\S]*assertWorkMarketplaceBroadcastAllowed/u,
);
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
assert.match(
  backfillSource,
  /dense_rank\(\) OVER \([\s\S]*ORDER BY indexed_through_block DESC NULLS LAST/u,
);
assert.match(
  backfillSource,
  /Math\.max\([\s\S]*512,[\s\S]*Math\.floor\(Number\(canonicalSummaryLimit\)/u,
);
assert.match(
  backfillSource,
  /workMarketPricing'->>'confirmationOracleBlockHeight'[\s\S]*workMarketPricing'->>'confirmationOracleBlockHash'/u,
);
assert.match(
  apiSource,
  /!workMarketV4QuoteHeightWithinBound\([\s\S]*return \[\];/u,
);
assert.ok(
  [
    ...backfillSource.matchAll(
      /oracle_snapshot\.snapshot_id = EXCLUDED\.snapshot_id/gu,
    ),
  ].length >= 2,
);

console.log("WORK Marketplace V2 pricing contract passed.");
