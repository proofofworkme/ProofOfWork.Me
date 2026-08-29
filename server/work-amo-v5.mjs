import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import * as ecc from "@bitcoinerlab/secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import {
  assertCanonicalUnicodeCaseMappingVersion,
  compareCanonicalUtf8,
} from "./canonical-order.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE,
  WORK_TOKEN_ID,
} from "./work-units.mjs";

bitcoin.initEccLib(ecc);

export const WORK_AMO_V5_AUTH_VERSION = "pwt-sale-v5";
const WORK_AMO_V5_SUCCESSOR_AUTH_VERSIONS = new Set([
  "pwt-sale-v6",
  "pwt-sale-v7",
  "pwt-sale-v8",
]);
export const WORK_AMO_V5_ACTIVATION_HEIGHT = 959_621;
export const WORK_AMO_V5_DECLARATION_TXID =
  "54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36";
export const WORK_AMO_V5_DECLARATION_HEIGHT = 959_620;
export const WORK_AMO_V5_DECLARATION_BLOCK_HASH =
  "0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811";
export const WORK_AMO_V5_DECLARATION_BLOCK_INDEX = 141;
export const WORK_AMO_V5_DECLARATION_BLOCK_TIME =
  "2026-07-26T00:17:29.000Z";
export const WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT = 3;
export const WORK_AMO_V5_DECLARATION_RECORD_ORDINAL = 0;
export const WORK_AMO_V5_DECLARATION_REGISTRY_PAYMENT_VOUT = 4;
export const WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT = 5;
export const WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY =
  "76a91499b91dd27a616a71c0a1e9db6a86ceb8cff284c588ac";
export const WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS =
  "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
export const WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS = 546;
export const WORK_AMO_V5_DECLARATION_PAYLOAD_SHA256 =
  "d947a9adaa9d84d05571d2addd210cc4aa194eac94562411397553ef8135f95f";
export const WORK_AMO_V5_DECLARATION_PAYLOAD_BYTES = 17_052;
export const WORK_AMO_V5_V1_DECLARATION_TXID =
  "b578601bf1c1804b6afb4b030cfa5207c9894f4b5a2d2bc5ce5a9369534ed837";
export const WORK_AMO_V5_V1_DECLARATION_HEIGHT = 959_305;
export const WORK_AMO_V5_V1_DECLARATION_BLOCK_HASH =
  "00000000000000000000e82cdcdca5f072924d79790f2e4301330d4338d8eb30";
export const WORK_AMO_V5_V1_DECLARATION_BLOCK_INDEX = 1_187;
export const WORK_AMO_V5_V1_ACTIVATION_HEIGHT = 959_306;
export const WORK_AMO_V5_PRE_UNIT_RELIC_MODEL =
  "canonical-work-amo-v5-pre-unit-relic-v1";
export const WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID =
  "4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1";
export const WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HASH =
  "000000000000000000007933e0dc73604a52057ba18de7b9463b65d9433dd0fe";
export const WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT = 959_241;
export const WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX = 2_601;
export const WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_TIME =
  "2026-07-23T09:47:50.000Z";
export const WORK_AMO_V5_PRE_UNIT_RELIC_PROTOCOL_VOUT = 1;
export const WORK_AMO_V5_PRE_UNIT_RELIC_RECORD_ORDINAL = 0;
export const WORK_AMO_V5_PRE_UNIT_RELIC_AUTH_VERSION = "pwt-sale-v3";
export const WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS = "1600";
export const WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS = 1_500_479;
export const WORK_AMO_V5_PRE_UNIT_RELIC_MINIMUM_PRICE_SATS = 1_500_477;
export const WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS =
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
export const WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_PUBLIC_KEY =
  "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237";
export const WORK_AMO_V5_PRE_UNIT_RELIC_NONCE = "mrxbidku-hlnygfgz";
export const WORK_AMO_V5_PRE_UNIT_RELIC_REGISTRY_ADDRESS =
  "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
export const WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT = 2;
export const WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS = 546;
export const WORK_AMO_V5_PRE_UNIT_RELIC_ANCHOR_SCRIPT_PUBKEY =
  "51207f0c17f4c158ce3415b36a17f71a6f7cab701f673d9077ac0d7af4fad03c5bae";
export const WORK_AMO_V5_PRE_UNIT_RELIC_MINER_FEE_SATS = 3_890;
export const WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES = 1_251;
export const WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_MODEL =
  "canonical-work-market-h-minus-one-v1";
export const WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_BLOCK_HEIGHT = 959_240;
export const WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_BLOCK_HASH =
  "0000000000000000000181919d7c56d488be45525c0c1659b46439d21496f911";
export const WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_NETWORK_VALUE_Q8 =
  "196937530758698091074146532";
export const WORK_AMO_V5_PRE_UNIT_RELIC_DISABLED_REASON =
  "work-amo-v5-pre-unit-relic";
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_MODEL =
  "canonical-work-amo-v5-legacy-bootstrap-carry-v1";
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_TXID =
  "5eb0a876603a7551653806b932533dc27a884631a581caa2e36dcf129b8278e8";
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_BLOCK_HASH =
  "000000000000000000005a63a2c00834b92746ab0658c9f0c98aeb509724e8f9";
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_BLOCK_HEIGHT = 959_311;
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_BLOCK_INDEX = 2_552;
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_PROTOCOL_VOUT = 1;
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_RECORD_ORDINAL = 0;
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_REASON_CODE =
  "work-market-v4-version-required";
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_MUTATION_SATS = 546;
export const WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_MINER_FEE_SATS = 2_216;

export const WORK_AMO_V5_UNIT_MODEL =
  "canonical-work-amo-usd-unit-v2";
export const WORK_AMO_V5_STATE_ORDER_MODEL =
  "canonical-proof-state-order-v1";
export const WORK_AMO_V5_AMOUNT_MODEL =
  "canonical-confirmed-position-derived-work-amount-v1";
export const WORK_AMO_V5_UNIT_USD_ORACLE_MODEL =
  "canonical-amo-chain-usd-quote-v1";
export const WORK_AMO_V5_UNIT_WORK_ORACLE_MODEL =
  "canonical-work-prefix-before-action-v1";
export const WORK_AMO_V5_BOND_TRANSITION_MODEL =
  "canonical-compute-then-bond-v1";
export const WORK_AMO_V5_BLOCK_SEQUENCER_MODEL =
  "canonical-work-amo-full-position-block-sequencer-v2";
export const WORK_AMO_V5_STATE_COMMITMENT_MODEL =
  "canonical-work-amo-sufficient-state-sha256-v1";
export const WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL =
  "canonical-work-amo-payload-sha256-v1";
export const WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL =
  "canonical-work-amo-network-accumulator-v1";
export const WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL =
  "canonical-work-amo-event-set-sha256-v1";
export const WORK_AMO_V5_TOKEN_STATE_PREIMAGE_MODEL =
  "canonical-work-amo-token-state-preimage-v1";
export const WORK_AMO_V5_BASE_STATE_FIELDS = Object.freeze([
  "browserFlowSats",
  "computerEventFlowSats",
  "driveFlowSats",
  "idMarketplaceFeeSats",
  "idMarketplaceVolumeSats",
  "inceptionBondFlowSats",
  "infinityBondFlowSats",
  "mailFlowSats",
  "powids",
  "tokenCreationFlowSats",
  "tokenMarketplaceFeeSats",
  "tokenMintFlowSats",
  "tokenSaleVolumeSats",
  "tokenTransferFlowSats",
]);
export const WORK_AMO_V4_AUTH_VERSION = "pwt-sale-v4";
export const WORK_AMO_V5_LEGACY_LISTING_AUTH_VERSIONS =
  Object.freeze([
    "pwt-sale-v1",
    "pwt-sale-v2",
    "pwt-sale-v3",
  ]);
export const WORK_AMO_V4_UNIT_MODEL =
  "canonical-work-amo-usd-unit-v1";
export const WORK_AMO_V4_ORACLE_MODEL =
  "canonical-work-market-confirmation-floor-v1";
export const WORK_AMO_V5_MODELS = Object.freeze({
  amountModel: WORK_AMO_V5_AMOUNT_MODEL,
  bondTransitionModel: WORK_AMO_V5_BOND_TRANSITION_MODEL,
  stateOrderModel: WORK_AMO_V5_STATE_ORDER_MODEL,
  unitModel: WORK_AMO_V5_UNIT_MODEL,
  unitUsdOracleModel: WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
  unitWorkOracleModel: WORK_AMO_V5_UNIT_WORK_ORACLE_MODEL,
});

export const WORK_AMO_V5_ALLOWED_FACE_USD_CENTS = Object.freeze([
  2_000,
  5_000,
  10_000,
]);
export const WORK_AMO_V4_HISTORICAL_FACE_USD_CENTS = Object.freeze([
  1_000,
  2_000,
  5_000,
  10_000,
  20_000,
  50_000,
  100_000,
  200_000,
  500_000,
  1_000_000,
]);
export const WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS = 144;
export const WORK_AMO_V5_USD_QUOTE_PREFIX = "pwa1:usd1:";
export const WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION = "pwt-sale-v1";
export const WORK_AMO_V5_ID_SALE_AUTH_VERSION = "pwid-sale-v4";
export const WORK_AMO_V5_ID_REGISTRY_ADDRESS =
  "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
export const WORK_AMO_V5_TOKEN_INDEX_ADDRESS =
  "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn";
export const WORK_AMO_V5_POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
export const WORK_AMO_V5_INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
export const WORK_AMO_V5_LISTING_ANCHOR_VOUT = 2;
export const WORK_AMO_V5_LISTING_ANCHOR_VALUE_SATS = 546;
export const WORK_AMO_V5_LISTING_ANCHOR_SIGHASH_TYPE = 0x83;

export const WORK_AMO_V5_MAX_SUPPLY = 21_000_000n;
export const WORK_AMO_V5_ATOMS_PER_WORK = 100_000_000n;
export const WORK_AMO_V5_ATOM_MOVEMENT_DENOMINATOR =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK;
export const WORK_AMO_V5_SUBATOM_MOVEMENT_DENOMINATOR =
  WORK_AMO_V5_MAX_SUPPLY * WORK_SUBATOM_UNIT_SCALE;
export const WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE = 100_000_000n;
export const WORK_AMO_V5_PROOFS_PER_QUOTE_UNIT = 100_000_000n;
export const WORK_AMO_V5_USD_QUOTE_Q8_SCALE = 100_000_000n;
const WORK_AMO_V5_GROWTH_VALUE_MULTIPLE = 5n;
const WORK_AMO_V5_ID_DENSITY_NUMERATOR = 26_868_933_906_745_133n;
const WORK_AMO_V5_ID_DENSITY_DENOMINATOR = 100_000_000_000_000n;

export const compareWorkAmoUtf8 = compareCanonicalUtf8;
const WORK_AMO_V5_FATAL_UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
});

function workAmoV5ExactPositiveInteger(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    return null;
  }
  const integer = BigInt(text);
  return integer > 0n ? integer : null;
}

function workAmoV5AmountPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

export function workAmoV5MovementAmountUnits(movement) {
  const amountAtomsPresent = workAmoV5AmountPresent(
    movement?.amountAtoms,
  );
  const amountSubatomsPresent = workAmoV5AmountPresent(
    movement?.amountSubatoms,
  );
  const storageModel = String(movement?.amountStorageModel ?? "")
    .trim()
    .toLowerCase();
  if (
    storageModel === WORK_SUBATOM_PROJECTION_MODEL &&
    !amountSubatomsPresent
  ) {
    return null;
  }
  if (
    storageModel === WORK_ATOMIC_PROJECTION_MODEL &&
    !amountAtomsPresent
  ) {
    return null;
  }
  const amountAtoms = amountAtomsPresent
    ? workAmoV5ExactPositiveInteger(movement?.amountAtoms)
    : null;
  const amountSubatoms = amountSubatomsPresent
    ? workAmoV5ExactPositiveInteger(movement?.amountSubatoms)
    : null;
  if (
    (amountAtomsPresent && amountAtoms === null) ||
    (amountSubatomsPresent && amountSubatoms === null)
  ) {
    return null;
  }
  if (amountSubatoms !== null) {
    if (
      amountAtoms !== null &&
      amountSubatoms !== amountAtoms * WORK_SUBATOM_CONVERSION_FACTOR
    ) {
      return null;
    }
    return {
      amount: amountSubatoms,
      amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
      denominator: WORK_AMO_V5_SUBATOM_MOVEMENT_DENOMINATOR,
    };
  }
  if (amountAtoms !== null) {
    return {
      amount: amountAtoms,
      amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
      denominator: WORK_AMO_V5_ATOM_MOVEMENT_DENOMINATOR,
    };
  }
  return null;
}

export function workAmoV5MovementValueAtNetworkQ8(
  movement,
  networkValueQ8,
) {
  const valueQ8 = workAmoV5ExactPositiveInteger(networkValueQ8);
  const units = workAmoV5MovementAmountUnits(movement);
  if (!valueQ8 || !units) {
    return null;
  }
  return (units.amount * valueQ8) / units.denominator;
}

export function workAmoV5WorkStateWithoutLegacyListingReservations(
  tokenState,
) {
  const source =
    tokenState &&
    typeof tokenState === "object" &&
    !Array.isArray(tokenState)
      ? tokenState
      : {};
  return {
    ...source,
    listings: (Array.isArray(source.listings)
      ? source.listings
      : []
    ).filter((listing) => {
      const presentAuthorizations = [
        listing?.saleAuthorization,
        listing?.listingAuthorization,
      ].filter(
        (authorization) =>
          authorization !== undefined && authorization !== null,
      );
      if (
        presentAuthorizations.some(
          (authorization) =>
            typeof authorization !== "object" ||
            Array.isArray(authorization) ||
            !String(authorization.version ?? "").trim(),
        )
      ) {
        return true;
      }
      const presentVersions = presentAuthorizations.map(
        (authorization) => String(authorization.version).trim(),
      );
      return !(
        presentVersions.length > 0 &&
        new Set(presentVersions).size === 1 &&
        WORK_AMO_V5_LEGACY_LISTING_AUTH_VERSIONS.includes(
          presentVersions[0],
        )
      );
    }),
  };
}

export function workAmoV5CutoverActivationIsExact(activation) {
  return (
    activation?.active === true &&
    activation?.canonical === true &&
    activation?.confirmed === true &&
    activation?.evidenceComplete === true &&
    normalizedTxid(activation?.txid ?? activation?.declarationTxid) ===
      WORK_AMO_V5_DECLARATION_TXID &&
    Number(activation?.blockHeight) === WORK_AMO_V5_DECLARATION_HEIGHT &&
    String(activation?.blockHash ?? "").trim().toLowerCase() ===
      WORK_AMO_V5_DECLARATION_BLOCK_HASH &&
    Number(
      activation?.blockTransactionIndex ?? activation?.blockIndex,
    ) === WORK_AMO_V5_DECLARATION_BLOCK_INDEX &&
    Number(activation?.activationHeight) === WORK_AMO_V5_ACTIVATION_HEIGHT
  );
}

function workAmoV5ListingIdentity(listing) {
  return normalizedTxid(listing?.listingId ?? listing?.txid);
}

function workAmoV5ListingAuthorizationVersion(listing) {
  const versions = [
    listing?.saleAuthorization?.version,
    listing?.listingAuthorization?.version,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toLowerCase());
  return versions.length > 0 && new Set(versions).size === 1
    ? versions[0]
    : "";
}

export function workAmoV5PreUnitRelicEvidenceIsExact(evidence) {
  const listing =
    evidence?.listing &&
    typeof evidence.listing === "object" &&
    !Array.isArray(evidence.listing)
      ? evidence.listing
      : null;
  const disposition = String(evidence?.disposition ?? "")
    .trim()
    .toLowerCase();
  const terminal = disposition === "terminal";
  const canonicalSpendCount = evidence?.canonicalSpendCount;
  const canonicalCloseCount = evidence?.canonicalCloseCount;
  const canonicalCloseSaleCount = evidence?.canonicalCloseSaleCount;
  const canonicalCloseClosedCount =
    evidence?.canonicalCloseClosedCount;
  const canonicalSpendCountExact =
    Number.isSafeInteger(canonicalSpendCount) &&
    (canonicalSpendCount === 0 || canonicalSpendCount === 1);
  const canonicalCloseCountsExact =
    Number.isSafeInteger(canonicalCloseCount) &&
    Number.isSafeInteger(canonicalCloseSaleCount) &&
    Number.isSafeInteger(canonicalCloseClosedCount);
  const canonicalCloseCardinalityExact =
    canonicalCloseCountsExact &&
    (
      (
        canonicalCloseCount === 0 &&
        canonicalCloseSaleCount === 0 &&
        canonicalCloseClosedCount === 0
      ) ||
      (
        canonicalCloseCount === 1 &&
        (canonicalCloseSaleCount === 0 ||
          canonicalCloseSaleCount === 1) &&
        canonicalCloseClosedCount === 1
      )
    );
  return (
    evidence?.complete === true &&
    evidence?.canonical === true &&
    evidence?.confirmed === true &&
    evidence?.valid === true &&
    evidence?.model === WORK_AMO_V5_PRE_UNIT_RELIC_MODEL &&
    normalizedTxid(evidence?.activationTxid) ===
      WORK_AMO_V5_DECLARATION_TXID &&
    String(evidence?.activationBlockHash ?? "").trim().toLowerCase() ===
      WORK_AMO_V5_DECLARATION_BLOCK_HASH &&
    Number(evidence?.activationBlockHeight) ===
      WORK_AMO_V5_DECLARATION_HEIGHT &&
    Number(evidence?.activationBlockIndex) ===
      WORK_AMO_V5_DECLARATION_BLOCK_INDEX &&
    String(evidence?.activationBlockTime ?? "") ===
      WORK_AMO_V5_DECLARATION_BLOCK_TIME &&
    normalizedTxid(evidence?.listingId ?? evidence?.txid) ===
      WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID &&
    String(evidence?.blockHash ?? "").trim().toLowerCase() ===
      WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HASH &&
    Number(evidence?.blockHeight) ===
      WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT &&
    Number(evidence?.blockIndex) === WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX &&
    Number.isSafeInteger(Number(evidence?.eventId)) &&
    Number(evidence.eventId) > 0 &&
    Number(evidence?.protocolVout) ===
      WORK_AMO_V5_PRE_UNIT_RELIC_PROTOCOL_VOUT &&
    Number(evidence?.recordOrdinal) ===
      WORK_AMO_V5_PRE_UNIT_RELIC_RECORD_ORDINAL &&
    String(evidence?.authorizationVersion ?? "").trim().toLowerCase() ===
      WORK_AMO_V5_PRE_UNIT_RELIC_AUTH_VERSION &&
    String(evidence?.amountAtoms ?? "") ===
      WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS &&
    Number(evidence?.priceSats) === WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS &&
    String(evidence?.sellerAddress ?? "").trim() ===
      WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS &&
    String(evidence?.registryAddress ?? "").trim() ===
      WORK_AMO_V5_PRE_UNIT_RELIC_REGISTRY_ADDRESS &&
    normalizedTxid(evidence?.saleTicketTxid) ===
      WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID &&
    Number(evidence?.saleTicketVout) ===
      WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT &&
    Number(evidence?.saleTicketValueSats) ===
      WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS &&
    canonicalSpendCountExact &&
    canonicalCloseCardinalityExact &&
    (disposition === "relic" || terminal) &&
    (terminal
      ? evidence?.terminal === true &&
        canonicalSpendCount === 1 &&
        normalizedTxid(evidence?.canonicalSpendTxid) &&
        (
          canonicalCloseCount === 0 ||
          (
            canonicalCloseCount === 1 &&
            normalizedTxid(evidence?.canonicalCloseTxid) ===
              normalizedTxid(evidence?.canonicalSpendTxid)
          )
        )
      : evidence?.terminal === false &&
        canonicalSpendCount === 0 &&
        canonicalCloseCount === 0 &&
        evidence?.unspent === true &&
        listing &&
        workAmoV5ListingIdentity(listing) ===
          WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID &&
        workAmoV5ListingTokenId(listing) === WORK_TOKEN_ID &&
        workAmoV5ListingAuthorizationVersion(listing) ===
          WORK_AMO_V5_PRE_UNIT_RELIC_AUTH_VERSION &&
        String(listing?.amountAtoms ?? "") ===
          WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS &&
        Number(listing?.priceSats) ===
          WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS &&
        listing?.confirmed === true)
  );
}

function workAmoV5ListingTokenId(listing) {
  return String(
    listing?.tokenId ??
      listing?.saleAuthorization?.tokenId ??
      listing?.listingAuthorization?.tokenId ??
      "",
  )
    .trim()
    .toLowerCase();
}

/**
 * Projects the confirmed AMO boundary over relational/snapshot token state.
 * Raw listing rows remain replayable evidence; only their public reserving
 * status changes. The exact declaration evidence must be attached first.
 */
export function applyWorkAmoV5CutoverToTokenState(state) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state)
  ) {
    return state;
  }
  const indexedThroughBlock = Number(
    state.indexedThroughBlock ?? state.stats?.indexedThroughBlock,
  );
  if (
    String(state.network ?? "").trim().toLowerCase() !== "livenet" ||
    !Number.isSafeInteger(indexedThroughBlock) ||
    indexedThroughBlock < WORK_AMO_V5_ACTIVATION_HEIGHT
  ) {
    return state;
  }

  const activationExact = workAmoV5CutoverActivationIsExact(
    state.workAmoV5Activation,
  );
  const relicEvidenceExact = workAmoV5PreUnitRelicEvidenceIsExact(
    state.workAmoV5PreUnitRelicEvidence,
  );
  const relicDisposition =
    activationExact && relicEvidenceExact
      ? String(state.workAmoV5PreUnitRelicEvidence.disposition)
      : "";
  const sourceListings = Array.isArray(state.listings) ? state.listings : [];
  const listings = sourceListings.filter((listing) => {
    if (workAmoV5ListingTokenId(listing) !== WORK_TOKEN_ID) {
      return true;
    }
    const listingId = workAmoV5ListingIdentity(listing);
    const version = workAmoV5ListingAuthorizationVersion(listing);
    return (
      listingId !== WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID &&
      (
        version === WORK_AMO_V5_AUTH_VERSION ||
        WORK_AMO_V5_SUCCESSOR_AUTH_VERSIONS.has(version) ||
        (
          version === WORK_AMO_V4_AUTH_VERSION &&
          listing?.confirmed === true &&
          Number.isSafeInteger(Number(listing?.blockHeight)) &&
          Number(listing.blockHeight) > 0 &&
          Number(listing.blockHeight) < WORK_AMO_V5_ACTIVATION_HEIGHT
        )
      )
    );
  });
  let closedListings = Array.isArray(state.closedListings)
    ? state.closedListings.filter(
        (listing) =>
          !(
            workAmoV5ListingIdentity(listing) ===
              WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID &&
            listing?.disabledReason ===
              WORK_AMO_V5_PRE_UNIT_RELIC_DISABLED_REASON
          ),
      )
    : [];
  const invalidEvents = Array.isArray(state.invalidEvents)
    ? state.invalidEvents
    : [];
  const closedIds = new Set(
    closedListings.map(workAmoV5ListingIdentity).filter(Boolean),
  );
  if (relicDisposition === "relic" && !closedIds.has(
    WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  )) {
    const evidenceListing = state.workAmoV5PreUnitRelicEvidence.listing;
    closedListings = [
      ...closedListings,
      {
        ...evidenceListing,
        closedAt:
          state.workAmoV5PreUnitRelicEvidence?.activationBlockTime ??
          state.workAmoV5Activation?.blockTime ??
          evidenceListing.createdAt,
        closedConfirmed: true,
        closedTxid: WORK_AMO_V5_DECLARATION_TXID,
        confirmed: true,
        disabledAtBlockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
        disabledByTxid: WORK_AMO_V5_DECLARATION_TXID,
        disabledReason: WORK_AMO_V5_PRE_UNIT_RELIC_DISABLED_REASON,
        kind: "token-listing-closed",
        listingId: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
        originalStatus: evidenceListing?.status ?? "active",
        refundEligible: false,
        relic: true,
        status: "disabled",
        txid: WORK_AMO_V5_DECLARATION_TXID,
      },
    ];
  }

  const removedListings = sourceListings.length - listings.length;
  const addedClosedListings =
    closedListings.length -
    (Array.isArray(state.closedListings) ? state.closedListings.length : 0);
  const projectionReady = activationExact && relicEvidenceExact;
  const confirmedOpenListings = listings.filter(
    (listing) => listing?.confirmed === true,
  ).length;
  const pendingOpenListings = listings.length - confirmedOpenListings;
  const relicListings = closedListings.filter(
    (listing) => listing?.relic === true,
  ).length;
  const existingTotalListings = Number(state?.totalCounts?.listings);
  const totalCounts =
    state.totalCounts && typeof state.totalCounts === "object"
      ? {
          ...state.totalCounts,
          ...(Number.isSafeInteger(Number(state.totalCounts.closedListings))
            ? {
                closedListings: Math.max(
                  0,
                  Number(state.totalCounts.closedListings) +
                    addedClosedListings,
                ),
              }
            : {}),
          listings: Number.isSafeInteger(existingTotalListings)
            ? Math.max(0, existingTotalListings - removedListings)
            : listings.length,
        }
      : state.totalCounts;
  const tokens = Array.isArray(state.tokens)
    ? state.tokens.map((token) =>
        workAmoV5ListingTokenId(token) === WORK_TOKEN_ID
          ? {
              ...token,
              confirmedOpenListings: listings.filter(
                (listing) =>
                  workAmoV5ListingTokenId(listing) === WORK_TOKEN_ID &&
                  listing?.confirmed === true,
              ).length,
              openListings: listings.filter(
                (listing) =>
                  workAmoV5ListingTokenId(listing) === WORK_TOKEN_ID,
              ).length,
              pendingOpenListings: listings.filter(
                (listing) =>
                  workAmoV5ListingTokenId(listing) === WORK_TOKEN_ID &&
                  listing?.confirmed !== true,
              ).length,
            }
          : token,
      )
    : state.tokens;

  return {
    ...state,
    closedListings,
    invalidEvents,
    listings,
    ...(tokens ? { tokens } : {}),
    ...(totalCounts ? { totalCounts } : {}),
    workAmoV5ProjectionReady: projectionReady,
    ...(state.stats && typeof state.stats === "object"
      ? {
          stats: {
            ...state.stats,
            activeListings: listings.length,
            confirmedOpenListings,
            invalidEvents: invalidEvents.filter(
              (event) => event?.confirmed === true,
            ).length,
            openListings: listings.length,
            pendingOpenListings,
            relicListings,
          },
        }
      : {}),
  };
}

export const WORK_AMO_V5_FROZEN_TERM_FIELDS = Object.freeze([
  "version",
  "unitModel",
  "stateOrderModel",
  "amountModel",
  "bondTransitionModel",
  "unitFaceUsd",
  "unitFaceUsdCents",
  "unitUsdOracleModel",
  "unitUsdQuoteTxid",
  "unitUsdQuoteVout",
  "unitUsdQuoteSequence",
  "unitUsdQuoteBlockHeight",
  "unitUsdQuoteBlockHash",
  "unitUsdQuoteBlockIndex",
  "unitUsdPer100mProofsQ8",
  "unitWorkOracleModel",
  "listingBlockHeight",
  "listingBlockHash",
  "listingBlockIndex",
  "listingProtocolVout",
  "listingRecordOrdinal",
  "unitNetworkValueBeforeQ8",
  "unitAmountAtoms",
  "unitPriceSats",
  "unitMinimumPriceSats",
  "listingBondContributionQ8",
  "unitNetworkValueAfterQ8",
]);

const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const PUBLIC_KEY_PATTERN =
  /^(?:[0-9a-f]{64}|(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})$/u;
const SIGNATURE_HEX_PATTERN = /^[0-9a-f]+$/u;
const POSITION_FIELDS = Object.freeze([
  "blockHeight",
  "blockTransactionIndex",
  "protocolVout",
  "recordOrdinal",
]);
const DERIVED_AUTHORIZATION_FIELDS = Object.freeze([
  "amount",
  "amountAtoms",
  "minimumPriceSats",
  "priceSats",
  "unitAmountAtoms",
  "unitFaceUsd",
  "unitMinimumPriceSats",
  "unitNetworkValueAfterQ8",
  "unitNetworkValueBeforeQ8",
  "unitPriceSats",
  "unitUsdPer100mProofsQ8",
  "unitUsdQuoteBlockHash",
  "unitUsdQuoteBlockHeight",
  "unitUsdQuoteBlockIndex",
  "unitUsdQuoteRecordOrdinal",
  "unitUsdQuoteSequence",
  "unitUsdQuoteTxid",
  "unitUsdQuoteVout",
]);

function invalid(reasonCode, detail = {}) {
  return { ...detail, reasonCode, valid: false };
}

function normalizedLowerText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedTxid(value) {
  const txid = normalizedLowerText(value);
  return TXID_PATTERN.test(txid) ? txid : "";
}

function canonicalSafeInteger(value, { positive = false } = {}) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    return null;
  }
  return value;
}

function canonicalExactSafeInteger(value, { positive = false } = {}) {
  const text = canonicalUnsignedIntegerText(value, { positive });
  if (!text) {
    return null;
  }
  const exact = BigInt(text);
  return exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
}

function canonicalCollectionValues(value) {
  return value &&
    typeof value !== "string" &&
    typeof value[Symbol.iterator] === "function"
    ? [...value]
    : [];
}

function canonicalUnsignedIntegerText(value, { positive = false } = {}) {
  if (
    typeof value !== "string" &&
    typeof value !== "bigint" &&
    typeof value !== "number"
  ) {
    return "";
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return "";
  }
  const text = String(value).trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    return "";
  }
  if (positive && text === "0") {
    return "";
  }
  return BigInt(text).toString();
}

function validPublicKeyHex(value) {
  return PUBLIC_KEY_PATTERN.test(normalizedLowerText(value));
}

function validSignatureHex(value) {
  const signature = normalizedLowerText(value);
  return (
    SIGNATURE_HEX_PATTERN.test(signature) &&
    signature.length >= 18 &&
    signature.length <= 146 &&
    signature.length % 2 === 0
  );
}

function positiveBigInt(value) {
  const text = canonicalUnsignedIntegerText(value, { positive: true });
  return text ? BigInt(text) : null;
}

function nonNegativeBigInt(value) {
  const text = canonicalUnsignedIntegerText(value);
  return text ? BigInt(text) : null;
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function positionSource(value) {
  return value?.position && typeof value.position === "object"
    ? value.position
    : value;
}

export function normalizeWorkAmoCanonicalPosition(value) {
  const source = positionSource(value);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const blockHeight = canonicalSafeInteger(source.blockHeight, {
    positive: true,
  });
  const blockTransactionIndex = canonicalSafeInteger(
    source.blockTransactionIndex ?? source.blockIndex,
  );
  const protocolVout = canonicalSafeInteger(
    source.protocolVout ?? source.opReturnVout,
  );
  const recordOrdinal = canonicalSafeInteger(source.recordOrdinal);
  const blockHash = normalizedTxid(source.blockHash);
  if (
    blockHeight === null ||
    blockTransactionIndex === null ||
    protocolVout === null ||
    recordOrdinal === null ||
    !blockHash
  ) {
    return null;
  }
  return {
    blockHash,
    blockHeight,
    blockTransactionIndex,
    protocolVout,
    recordOrdinal,
  };
}

export function compareWorkAmoCanonicalPositions(left, right) {
  const normalizedLeft = normalizeWorkAmoCanonicalPosition(left);
  const normalizedRight = normalizeWorkAmoCanonicalPosition(right);
  if (!normalizedLeft || !normalizedRight) {
    throw new TypeError("Canonical AMO position is incomplete or invalid.");
  }
  for (const field of POSITION_FIELDS) {
    if (normalizedLeft[field] !== normalizedRight[field]) {
      return normalizedLeft[field] < normalizedRight[field] ? -1 : 1;
    }
  }
  return 0;
}

export function workAmoCanonicalPositionPrecedes(left, right) {
  try {
    const normalizedLeft = normalizeWorkAmoCanonicalPosition(left);
    const normalizedRight = normalizeWorkAmoCanonicalPosition(right);
    if (
      !normalizedLeft ||
      !normalizedRight ||
      (normalizedLeft.blockHeight === normalizedRight.blockHeight &&
        normalizedLeft.blockHash !== normalizedRight.blockHash)
    ) {
      return false;
    }
    return compareWorkAmoCanonicalPositions(normalizedLeft, normalizedRight) < 0;
  } catch {
    return false;
  }
}

function declarationPositionFromEvidence(evidence) {
  return normalizeWorkAmoCanonicalPosition({
    blockHash: evidence?.blockHash,
    blockHeight: evidence?.blockHeight,
    blockTransactionIndex:
      evidence?.blockTransactionIndex ?? evidence?.blockIndex,
    protocolVout: evidence?.protocolVout,
    recordOrdinal: evidence?.recordOrdinal,
  });
}

export function validateWorkAmoV5DeclarationEvidence(evidence) {
  if (evidence?.confirmed !== true || evidence?.canonical !== true) {
    return invalid("work-amo-v5-declaration-unconfirmed");
  }
  if (normalizedTxid(evidence?.txid) !== WORK_AMO_V5_DECLARATION_TXID) {
    return invalid("work-amo-v5-declaration-txid-mismatch");
  }
  const position = declarationPositionFromEvidence(evidence);
  if (!position) {
    return invalid("work-amo-v5-declaration-position-unavailable");
  }
  if (
    position.blockHeight !== WORK_AMO_V5_DECLARATION_HEIGHT ||
    position.blockHash !== WORK_AMO_V5_DECLARATION_BLOCK_HASH ||
    position.blockTransactionIndex !== WORK_AMO_V5_DECLARATION_BLOCK_INDEX ||
    position.protocolVout !== WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT ||
    position.recordOrdinal !== WORK_AMO_V5_DECLARATION_RECORD_ORDINAL
  ) {
    return invalid("work-amo-v5-declaration-position-mismatch");
  }
  const authorityScript = normalizedLowerText(
    evidence?.firstInputPrevoutScriptPubKey ??
      evidence?.inputZeroPrevoutScriptPubKey,
  );
  if (authorityScript !== WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY) {
    return invalid("work-amo-v5-declaration-authority-mismatch");
  }
  const payload =
    typeof evidence?.payload === "string"
      ? evidence.payload
      : typeof evidence?.payloadText === "string"
        ? evidence.payloadText
        : null;
  const payloadSha256 = payload
    ? sha256Text(payload)
    : normalizedLowerText(evidence?.payloadSha256);
  const payloadBytes = payload
    ? Buffer.byteLength(payload, "utf8")
    : canonicalSafeInteger(evidence?.payloadBytes, { positive: true });
  if (
    payloadSha256 !== WORK_AMO_V5_DECLARATION_PAYLOAD_SHA256 ||
    payloadBytes !== WORK_AMO_V5_DECLARATION_PAYLOAD_BYTES
  ) {
    return invalid("work-amo-v5-declaration-payload-mismatch");
  }
  const registryAddress = String(evidence?.registryAddress ?? "").trim();
  const registryPaymentSats = canonicalSafeInteger(
    evidence?.registryPaymentSats,
  );
  const registryPaymentVout = canonicalSafeInteger(
    evidence?.registryPaymentVout,
  );
  const workProtocolVout = canonicalSafeInteger(
    evidence?.workProtocolVout ?? evidence?.governedProtocolVout,
  );
  if (
    registryAddress !== WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
    registryPaymentSats === null ||
    registryPaymentSats < WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS
  ) {
    return invalid("work-amo-v5-declaration-registry-payment-invalid");
  }
  if (
    registryPaymentVout !== WORK_AMO_V5_DECLARATION_REGISTRY_PAYMENT_VOUT ||
    workProtocolVout !== WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT ||
    registryPaymentVout >= workProtocolVout
  ) {
    return invalid("work-amo-v5-declaration-output-order-invalid");
  }
  const activation = {
    activationHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    declarationBlockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
    declarationBlockIndex: WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
    declarationHeight: WORK_AMO_V5_DECLARATION_HEIGHT,
    declarationProtocolVout: WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT,
    declarationRecordOrdinal: WORK_AMO_V5_DECLARATION_RECORD_ORDINAL,
    declarationTxid: WORK_AMO_V5_DECLARATION_TXID,
  };
  return { activation, position, valid: true };
}

export function workAmoV5ActivationFromEvidence(evidence) {
  const validation = validateWorkAmoV5DeclarationEvidence(evidence);
  return validation.valid ? validation.activation : null;
}

export function workAmoV5ActivationReached(
  activation,
  checkpointBlockHeight,
) {
  const activationHeight = canonicalSafeInteger(
    activation?.activationHeight,
    { positive: true },
  );
  const checkpointHeight = canonicalSafeInteger(checkpointBlockHeight, {
    positive: true,
  });
  return (
    activationHeight === WORK_AMO_V5_ACTIVATION_HEIGHT &&
    checkpointHeight !== null &&
    checkpointHeight >= activationHeight
  );
}

export function workAmoV5StatusFromEvidence(
  evidence,
  {
    indexReady = false,
    quoteHead = null,
    tipHeight = null,
    writesConfigured = false,
  } = {},
) {
  const validation = validateWorkAmoV5DeclarationEvidence(evidence);
  const activation = validation.valid ? validation.activation : null;
  const normalizedTipHeight = canonicalSafeInteger(tipHeight, {
    positive: true,
  });
  const active =
    validation.valid &&
    workAmoV5ActivationReached(activation, normalizedTipHeight);
  const normalizedQuoteHead = normalizeCanonicalQuoteProjection(quoteHead);
  const quotePositionReady = Boolean(
    normalizedQuoteHead &&
      normalizedTipHeight !== null &&
      normalizedQuoteHead.blockHeight >= WORK_AMO_V5_V1_ACTIVATION_HEIGHT &&
      normalizedQuoteHead.blockHeight <= normalizedTipHeight,
  );
  const quoteFreshForNextBlock = Boolean(
    quotePositionReady &&
      normalizedTipHeight + 1 <=
        normalizedQuoteHead.blockHeight + WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
  );
  const quoteReady = quotePositionReady && quoteFreshForNextBlock;
  const protocolWritesEnabled =
    active &&
    indexReady === true &&
    writesConfigured === true;
  const listingWritesEnabled = protocolWritesEnabled && quoteReady;
  const reasonCode = !validation.valid
    ? validation.reasonCode
    : !active
      ? "work-amo-v5-activation-pending"
      : indexReady !== true
        ? "work-amo-v5-index-not-ready"
        : !quotePositionReady
          ? "work-amo-v5-quote-not-ready"
          : !quoteFreshForNextBlock
            ? "work-amo-v5-quote-expired"
          : writesConfigured !== true
            ? "work-amo-v5-writes-not-configured"
            : "";
  return {
    active,
    activationHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    allowedFaceUsdCents: [...WORK_AMO_V5_ALLOWED_FACE_USD_CENTS],
    authVersion: WORK_AMO_V5_AUTH_VERSION,
    declarationBlockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
    declarationBlockIndex: WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
    declarationConfirmed: validation.valid,
    declarationHeight: WORK_AMO_V5_DECLARATION_HEIGHT,
    declarationProtocolVout: WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT,
    declarationTxid: WORK_AMO_V5_DECLARATION_TXID,
    indexReady: indexReady === true,
    listingWritesEnabled,
    maxQuoteAgeBlocks: WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
    models: WORK_AMO_V5_MODELS,
    quoteHead: normalizedQuoteHead,
    quoteReady,
    reasonCode,
    protocolWritesEnabled,
    writes: listingWritesEnabled,
    writesEnabled: listingWritesEnabled,
  };
}

export function parseWorkAmoUsdQuoteRecord(payload) {
  const text = String(payload ?? "");
  const parts = text.split(":");
  if (
    parts.length !== 6 ||
    parts[0] !== "pwa1" ||
    parts[1] !== "usd1"
  ) {
    return null;
  }
  const v1DeclarationTxid = normalizedTxid(parts[2]);
  const sequence = canonicalUnsignedIntegerText(parts[3], { positive: true });
  const previousQuoteTxid = normalizedTxid(parts[4]);
  const usdPer100mProofsQ8 = canonicalUnsignedIntegerText(parts[5], {
    positive: true,
  });
  if (
    v1DeclarationTxid !== WORK_AMO_V5_V1_DECLARATION_TXID ||
    !sequence ||
    !previousQuoteTxid ||
    !usdPer100mProofsQ8
  ) {
    return null;
  }
  return {
    payload: text,
    previousQuoteTxid,
    sequence,
    usdPer100mProofsQ8,
    v1DeclarationTxid,
  };
}

function workAmoV5JsonObjectKeysAreUnique(text) {
  let offset = 0;
  const skipWhitespace = () => {
    while (/[\t\n\r ]/u.test(text[offset] ?? "")) {
      offset += 1;
    }
  };
  const parseString = () => {
    if (text[offset] !== "\"") {
      return null;
    }
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      if (text[offset] === "\\") {
        offset += 2;
        continue;
      }
      if (text[offset] === "\"") {
        offset += 1;
        return JSON.parse(text.slice(start, offset));
      }
      offset += 1;
    }
    return null;
  };
  const parseValue = () => {
    skipWhitespace();
    if (text[offset] === "{") {
      offset += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[offset] === "}") {
        offset += 1;
        return true;
      }
      for (;;) {
        skipWhitespace();
        const key = parseString();
        if (typeof key !== "string" || keys.has(key)) {
          return false;
        }
        keys.add(key);
        skipWhitespace();
        if (text[offset] !== ":") {
          return false;
        }
        offset += 1;
        if (!parseValue()) {
          return false;
        }
        skipWhitespace();
        if (text[offset] === "}") {
          offset += 1;
          return true;
        }
        if (text[offset] !== ",") {
          return false;
        }
        offset += 1;
      }
    }
    if (text[offset] === "[") {
      offset += 1;
      skipWhitespace();
      if (text[offset] === "]") {
        offset += 1;
        return true;
      }
      for (;;) {
        if (!parseValue()) {
          return false;
        }
        skipWhitespace();
        if (text[offset] === "]") {
          offset += 1;
          return true;
        }
        if (text[offset] !== ",") {
          return false;
        }
        offset += 1;
      }
    }
    if (text[offset] === "\"") {
      return typeof parseString() === "string";
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return true;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u
      .exec(text.slice(offset))?.[0];
    if (!number) {
      return false;
    }
    offset += number.length;
    return true;
  };
  try {
    const valid = parseValue();
    skipWhitespace();
    return valid && offset === text.length;
  } catch {
    return false;
  }
}

function workAmoV5HasOnlyPairedSurrogates(value) {
  const stringValid = (text) => {
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          return false;
        }
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return false;
      }
    }
    return true;
  };
  if (typeof value === "string") {
    return stringValid(value);
  }
  if (Array.isArray(value)) {
    return value.every(workAmoV5HasOnlyPairedSurrogates);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).every(
      ([key, item]) =>
        stringValid(key) &&
        workAmoV5HasOnlyPairedSurrogates(item),
    );
  }
  return true;
}

export function workAmoV5HasNoTextStorageNul(
  value,
  ancestors = new Set(),
) {
  if (typeof value === "string") {
    return !value.includes("\u0000");
  }
  if (!value || typeof value !== "object") {
    return true;
  }
  if (ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  let valid = false;
  try {
    valid = (Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value)
    ).every(
      ([key, item]) =>
        !key.includes("\u0000") &&
        workAmoV5HasNoTextStorageNul(item, ancestors),
    );
  } catch {
    valid = false;
  }
  ancestors.delete(value);
  return valid;
}

export function decodeWorkAmoV5CanonicalBase64UrlJsonObject(value) {
  const encoded = String(value ?? "");
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return null;
  }
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (
      bytes.length === 0 ||
      bytes.toString("base64url") !== encoded
    ) {
      return null;
    }
    const text = WORK_AMO_V5_FATAL_UTF8_DECODER.decode(bytes);
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      return null;
    }
    if (!workAmoV5JsonObjectKeysAreUnique(text)) {
      return null;
    }
    const parsed = JSON.parse(text);
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      workAmoV5HasOnlyPairedSurrogates(parsed) &&
      workAmoV5HasNoTextStorageNul(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

const decodedWorkAmoV5Base64UrlJson =
  decodeWorkAmoV5CanonicalBase64UrlJsonObject;

export function isWorkAmoV5LivenetAddress(value) {
  try {
    bitcoin.address.toOutputScript(
      String(value ?? "").trim(),
      bitcoin.networks.bitcoin,
    );
    return true;
  } catch {
    return false;
  }
}

function workAmoV5NormalizedPowId(value) {
  assertCanonicalUnicodeCaseMappingVersion();
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "")
    .trim();
  return workAmoV5HasNoTextStorageNul(normalized)
    ? normalized
    : "";
}

function workAmoV5CanonicalBase64UrlText(value) {
  const encoded = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return "";
  }
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (
      bytes.length === 0 ||
      bytes.toString("base64url") !== encoded
    ) {
      return "";
    }
    const text = WORK_AMO_V5_FATAL_UTF8_DECODER.decode(bytes);
    return Buffer.from(text, "utf8").equals(bytes) &&
      workAmoV5HasNoTextStorageNul(text)
      ? text
      : "";
  } catch {
    return "";
  }
}

export function workAmoV5CanonicalExpiryMs(value) {
  if (value === "") {
    return null;
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return Number.NaN;
  }
  const epochMs = Date.parse(value);
  return Number.isSafeInteger(epochMs) &&
    new Date(epochMs).toISOString() === value
    ? epochMs
    : Number.NaN;
}

export function parseWorkAmoV5GenericSaleAuthorization(
  value,
  { network = "livenet" } = {},
) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  if (!source || !workAmoV5HasNoTextStorageNul(source)) {
    return null;
  }
  const version = String(
    source.version ?? WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION,
  ).trim();
  const tokenId = normalizedLowerText(source.tokenId);
  const ticker = String(source.ticker ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, 12);
  const bond =
    tokenId === WORK_AMO_V5_POWB_TOKEN_ID ||
    tokenId === WORK_AMO_V5_INCB_TOKEN_ID;
  const amount = bond
    ? canonicalUnsignedIntegerText(source.amount)
    : Math.max(0, Math.floor(Number(source.amount ?? 0)));
  const priceSats = Math.max(
    0,
    Math.floor(Number(source.priceSats ?? 0)),
  );
  const authorizationNetwork = String(
    source.network ?? "livenet",
  ).trim();
  const registryAddress = String(source.registryAddress ?? "").trim();
  const sellerAddress = String(source.sellerAddress ?? "").trim();
  const buyerAddress = String(source.buyerAddress ?? "").trim();
  const nonce = String(source.nonce ?? "").trim();
  const expiresAt = String(source.expiresAt ?? "").trim();
  const expiresAtMs = workAmoV5CanonicalExpiryMs(expiresAt);
  const anchorType = String(source.anchorType ?? "").trim();
  const anchorVout = Math.max(
    0,
    Math.floor(Number(source.anchorVout ?? 0)),
  );
  const anchorValueSats = Math.max(
    0,
    Math.floor(Number(source.anchorValueSats ?? 0)),
  );
  const anchorScriptPubKey = normalizedLowerText(
    source.anchorScriptPubKey,
  );
  const anchorSigHashType = Math.floor(
    Number(source.anchorSigHashType ?? 0),
  );
  const sellerPublicKey = normalizedLowerText(source.sellerPublicKey);
  const anchorTxid = normalizedLowerText(source.anchorTxid);
  const anchorSignature = normalizedLowerText(source.anchorSignature);
  if (
    version !== WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION ||
    !TXID_PATTERN.test(tokenId) ||
    tokenId === WORK_TOKEN_ID ||
    !ticker ||
    ticker.length > 12 ||
    (bond
      ? !canonicalUnsignedIntegerText(amount, { positive: true })
      : !Number.isSafeInteger(amount) || amount < 1) ||
    !Number.isSafeInteger(priceSats) ||
    priceSats < 1 ||
    authorizationNetwork !== network ||
    network !== "livenet" ||
    !isWorkAmoV5LivenetAddress(registryAddress) ||
    !isWorkAmoV5LivenetAddress(sellerAddress) ||
    (buyerAddress && !isWorkAmoV5LivenetAddress(buyerAddress)) ||
    !nonce ||
    nonce.length > 160 ||
    (expiresAt && !Number.isSafeInteger(expiresAtMs)) ||
    anchorType !== "sale-ticket-v1" ||
    anchorVout !== WORK_AMO_V5_LISTING_ANCHOR_VOUT ||
    anchorValueSats !== WORK_AMO_V5_LISTING_ANCHOR_VALUE_SATS ||
    !SIGNATURE_HEX_PATTERN.test(anchorScriptPubKey) ||
    !validPublicKeyHex(sellerPublicKey) ||
    anchorSigHashType !== WORK_AMO_V5_LISTING_ANCHOR_SIGHASH_TYPE ||
    (anchorTxid && !TXID_PATTERN.test(anchorTxid)) ||
    (anchorSignature && !validSignatureHex(anchorSignature))
  ) {
    return null;
  }
  return {
    amount,
    anchorScriptPubKey,
    anchorSigHashType,
    anchorSignature,
    anchorTxid,
    anchorType,
    anchorValueSats,
    anchorVout,
    buyerAddress,
    expiresAt,
    network: authorizationNetwork,
    nonce,
    priceSats,
    registryAddress,
    sellerAddress,
    sellerPublicKey,
    ticker,
    tokenId,
    version,
  };
}

export function workAmoV5GenericSaleAuthorizationsMatch(left, right) {
  const normalize = (value) => {
    const authorization = parseWorkAmoV5GenericSaleAuthorization(value);
    return authorization
      ? {
          ...authorization,
          anchorSignature: "",
          anchorTxid: "",
        }
      : null;
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
  );
}

export function parseWorkAmoV5IdSaleAuthorization(
  value,
  { network = "livenet" } = {},
) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  if (
    !source ||
    network !== "livenet" ||
    !workAmoV5HasNoTextStorageNul(source)
  ) {
    return null;
  }
  const id = workAmoV5NormalizedPowId(
    typeof source.id === "string" ? source.id : "",
  );
  const sellerAddress =
    typeof source.sellerAddress === "string"
      ? source.sellerAddress.trim()
      : "";
  const buyerAddress =
    typeof source.buyerAddress === "string"
      ? source.buyerAddress.trim()
      : "";
  const receiveAddress =
    typeof source.receiveAddress === "string"
      ? source.receiveAddress.trim()
      : "";
  const nonce =
    typeof source.nonce === "string" ? source.nonce.trim() : "";
  const expiresAt =
    typeof source.expiresAt === "string"
      ? source.expiresAt.trim()
      : "";
  const expiresAtMs = workAmoV5CanonicalExpiryMs(expiresAt);
  const priceSats =
    typeof source.priceSats === "number"
      ? Math.floor(source.priceSats)
      : Number.NaN;
  const anchorType =
    typeof source.anchorType === "string"
      ? source.anchorType.trim()
      : "";
  const anchorSigHashType =
    typeof source.anchorSigHashType === "number"
      ? Math.floor(source.anchorSigHashType)
      : Number.NaN;
  const anchorSignature =
    typeof source.anchorSignature === "string"
      ? source.anchorSignature.trim().toLowerCase()
      : "";
  const anchorScriptPubKey =
    typeof source.anchorScriptPubKey === "string"
      ? source.anchorScriptPubKey.trim().toLowerCase()
      : "";
  const anchorTxid =
    typeof source.anchorTxid === "string"
      ? source.anchorTxid.trim().toLowerCase()
      : "";
  const anchorVout =
    typeof source.anchorVout === "number"
      ? Math.floor(source.anchorVout)
      : Number.NaN;
  const anchorValueSats =
    typeof source.anchorValueSats === "number"
      ? Math.floor(source.anchorValueSats)
      : Number.NaN;
  const sellerPublicKey =
    typeof source.sellerPublicKey === "string"
      ? source.sellerPublicKey.trim().toLowerCase()
      : "";
  const signature =
    typeof source.signature === "string"
      ? source.signature.trim()
      : "";
  if (
    source.version !== WORK_AMO_V5_ID_SALE_AUTH_VERSION ||
    !id ||
    !isWorkAmoV5LivenetAddress(sellerAddress) ||
    (buyerAddress && !isWorkAmoV5LivenetAddress(buyerAddress)) ||
    (receiveAddress && !isWorkAmoV5LivenetAddress(receiveAddress)) ||
    !Number.isSafeInteger(priceSats) ||
    priceSats < 0 ||
    !nonce ||
    nonce.length > 160 ||
    (expiresAt && !Number.isSafeInteger(expiresAtMs)) ||
    anchorType !== "sale-ticket-v1" ||
    !Number.isSafeInteger(anchorVout) ||
    anchorVout < 0 ||
    !Number.isSafeInteger(anchorValueSats) ||
    anchorValueSats < WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS ||
    !SIGNATURE_HEX_PATTERN.test(anchorScriptPubKey) ||
    !validPublicKeyHex(sellerPublicKey) ||
    anchorSigHashType !== WORK_AMO_V5_LISTING_ANCHOR_SIGHASH_TYPE ||
    (anchorTxid && !TXID_PATTERN.test(anchorTxid)) ||
    (anchorSignature && !validSignatureHex(anchorSignature))
  ) {
    return null;
  }
  return {
    anchorScriptPubKey,
    anchorSigHashType,
    anchorSignature: anchorSignature || undefined,
    anchorTxid: anchorTxid || undefined,
    anchorType,
    anchorValueSats,
    anchorVout,
    buyerAddress: buyerAddress || undefined,
    expiresAt: expiresAt || undefined,
    id,
    nonce,
    priceSats,
    receiveAddress: receiveAddress || undefined,
    sellerAddress,
    sellerPublicKey,
    signature,
    version: WORK_AMO_V5_ID_SALE_AUTH_VERSION,
  };
}

export function workAmoV5IdSaleAuthorizationsMatch(left, right) {
  const normalize = (value) => {
    const authorization = parseWorkAmoV5IdSaleAuthorization(value);
    return authorization
      ? {
          ...authorization,
          anchorSignature: "",
          anchorTxid: "",
          signature: "",
        }
      : null;
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
  );
}

export function parseWorkAmoV5RawPwidRecord(payload) {
  const text = String(payload ?? "");
  if (
    !text.startsWith("pwid1:") ||
    !workAmoV5HasNoTextStorageNul(text)
  ) {
    return null;
  }
  const parts = text.slice("pwid1:".length).split(":");
  const decodedId = (value) =>
    workAmoV5NormalizedPowId(workAmoV5CanonicalBase64UrlText(value));
  if (
    (parts[0] === "r" || parts[0] === "r2") &&
    parts.length >= 4 &&
    parts.length <= 5
  ) {
    const id = workAmoV5NormalizedPowId(
      parts[0] === "r2"
        ? workAmoV5CanonicalBase64UrlText(parts[1])
        : parts[1],
    );
    const ownerAddress = String(parts[2] ?? "").trim();
    const receiveAddress = String(parts[3] ?? ownerAddress).trim();
    const pgpEncoded = String(parts[4] ?? "").trim();
    const pgpKey = pgpEncoded
      ? workAmoV5CanonicalBase64UrlText(pgpEncoded).trim()
      : "";
    return id &&
      isWorkAmoV5LivenetAddress(ownerAddress) &&
      isWorkAmoV5LivenetAddress(receiveAddress) &&
      (!pgpEncoded || pgpKey)
      ? {
          id,
          kind: "id-register",
          ownerAddress,
          pgpKey,
          receiveAddress,
        }
      : null;
  }
  if (parts[0] === "u" && parts.length === 3) {
    const id = decodedId(parts[1]);
    const receiveAddress = String(parts[2] ?? "").trim();
    return id && isWorkAmoV5LivenetAddress(receiveAddress)
      ? { id, kind: "id-update", receiveAddress }
      : null;
  }
  if (
    parts[0] === "t" &&
    parts.length >= 3 &&
    parts.length <= 4
  ) {
    const id = decodedId(parts[1]);
    const ownerAddress = String(parts[2] ?? "").trim();
    const receiveAddress = String(parts[3] ?? ownerAddress).trim();
    return id &&
      isWorkAmoV5LivenetAddress(ownerAddress) &&
      isWorkAmoV5LivenetAddress(receiveAddress)
      ? {
          id,
          kind: "id-transfer",
          ownerAddress,
          receiveAddress,
        }
      : null;
  }
  if (!["list5", "seal5", "delist5", "buy5"].includes(parts[0])) {
    return null;
  }
  const listingId =
    parts[0] === "list5"
      ? ""
      : normalizedLowerText(parts[1]);
  if (
    (parts[0] !== "list5" && !TXID_PATTERN.test(listingId)) ||
    (parts[0] === "list5" && parts.length !== 2) ||
    (parts[0] === "seal5" && parts.length !== 3) ||
    (parts[0] === "delist5" && parts.length !== 2) ||
    (parts[0] === "buy5" && (parts.length < 3 || parts.length > 4))
  ) {
    return null;
  }
  const ownerAddress =
    parts[0] === "buy5" ? String(parts[2] ?? "").trim() : "";
  const receiveAddress =
    parts[0] === "buy5"
      ? String(parts[3] ?? ownerAddress).trim()
      : "";
  if (
    parts[0] === "buy5" &&
    (!isWorkAmoV5LivenetAddress(ownerAddress) ||
      !isWorkAmoV5LivenetAddress(receiveAddress))
  ) {
    return null;
  }
  const saleAuthorization =
    parts[0] === "list5" || parts[0] === "seal5"
      ? parseWorkAmoV5IdSaleAuthorization(
          decodedWorkAmoV5Base64UrlJson(parts.at(-1)),
        )
      : null;
  if (
    (parts[0] === "list5" || parts[0] === "seal5") &&
    !saleAuthorization
  ) {
    return null;
  }
  return {
    kind: {
      buy5: "id-buy",
      delist5: "id-delist",
      list5: "id-list",
      seal5: "id-seal",
    }[parts[0]],
    listingId,
    ...(ownerAddress ? { ownerAddress, receiveAddress } : {}),
    ...(saleAuthorization ? { saleAuthorization } : {}),
  };
}

export function isWorkAmoV5BrowserHtmlBody(value) {
  const text = String(value ?? "").trim();
  return Boolean(
    text &&
      (
        /^<!doctype\s+html[\s>]/iu.test(text) ||
        /^<html[\s>]/iu.test(text) ||
        /<\/(?:html|head|body)>/iu.test(text) ||
        /^<(?:a|article|body|button|canvas|code|div|form|h[1-6]|head|img|input|main|ol|p|pre|script|section|span|style|svg|table|ul)(?:\s|>|\/)/iu.test(
          text,
        )
      )
  );
}

function workAmoV5Base64UrlBytes(value) {
  const encoded = String(value ?? "");
  if (!/^[A-Za-z0-9_-]*$/u.test(encoded)) {
    throw new Error("Invalid base64url data.");
  }
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) {
    throw new Error("Non-canonical base64url data.");
  }
  return bytes;
}

function workAmoV5Base64UrlUtf8Text(value) {
  const bytes = workAmoV5Base64UrlBytes(value);
  const text = WORK_AMO_V5_FATAL_UTF8_DECODER.decode(bytes);
  if (
    !Buffer.from(text, "utf8").equals(bytes) ||
    !workAmoV5HasNoTextStorageNul(text)
  ) {
    throw new Error("Non-canonical UTF-8 data.");
  }
  return text;
}

function workAmoV5PwmAttachmentPart(
  payload,
  current,
  maxAttachmentBytes,
) {
  const parts = payload.split(":");
  if (parts.length !== 7) {
    return current;
  }
  const [, mimeEncoded, nameEncoded, sizeText, sha256, partText, chunk] =
    parts;
  const size = Number(sizeText);
  const part = partText.match(/^(\d+)\/(\d+)$/u);
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > maxAttachmentBytes ||
    !/^[0-9a-f]{64}$/iu.test(sha256) ||
    !part
  ) {
    return current;
  }
  const index = Number(part[1]);
  const total = Number(part[2]);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    index < 0 ||
    index >= total
  ) {
    return current;
  }
  let mime;
  let name;
  try {
    mime = workAmoV5Base64UrlUtf8Text(mimeEncoded)
      .trim()
      .slice(0, 120) || "application/octet-stream";
    name = workAmoV5Base64UrlUtf8Text(nameEncoded)
      .trim()
      .replace(/\s+/gu, " ")
      .slice(0, 120) || "attachment";
  } catch {
    return current;
  }
  const accumulator =
    current &&
      current.mime === mime &&
      current.name === name &&
      current.size === size &&
      current.sha256 === sha256.toLowerCase() &&
      current.total === total
      ? current
      : {
          chunks: Array.from({ length: total }, () => ""),
          mime,
          name,
          sha256: sha256.toLowerCase(),
          size,
          total,
        };
  accumulator.chunks[index] = chunk;
  return accumulator;
}

function workAmoV5PwmAttachment(accumulator) {
  if (!accumulator || accumulator.chunks.some((chunk) => !chunk)) {
    return undefined;
  }
  const data = accumulator.chunks.join("");
  try {
    const bytes = workAmoV5Base64UrlBytes(data);
    if (
      bytes.byteLength !== accumulator.size ||
      createHash("sha256").update(bytes).digest("hex") !==
        accumulator.sha256
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return {
    data,
    mime: accumulator.mime,
    name: accumulator.name,
    sha256: accumulator.sha256,
    size: accumulator.size,
  };
}

export function parseWorkAmoV5PwmMessages(
  messages,
  { maxAttachmentBytes = 60_000 } = {},
) {
  let replyTo = "";
  let parentTxid = "";
  let attachmentAccumulator;
  let subject = "";
  const chunks = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const decoded = String(message ?? "");
    if (!decoded.startsWith("pwm1:")) {
      continue;
    }
    const payload = decoded.slice("pwm1:".length);
    if (payload.startsWith("f:")) {
      replyTo = payload.slice(2);
      continue;
    }
    if (payload.startsWith("s:")) {
      try {
        subject = workAmoV5Base64UrlUtf8Text(payload.slice(2))
          .trim()
          .replace(/\s+/gu, " ")
          .slice(0, 180);
      } catch {
        // Subject is optional. Ignore malformed subject records.
      }
      continue;
    }
    const reply = payload.match(/^r:([0-9a-fA-F]{64})$/u);
    if (reply) {
      parentTxid = reply[1].toLowerCase();
      continue;
    }
    if (payload.startsWith("m:")) {
      chunks.push(payload.slice(2));
      continue;
    }
    if (payload.startsWith("a:")) {
      attachmentAccumulator = workAmoV5PwmAttachmentPart(
        payload,
        attachmentAccumulator,
        maxAttachmentBytes,
      );
    }
    // Unknown pwm1 parts are non-semantic and ignored.
  }
  const memo = chunks.join("");
  const attachment = workAmoV5PwmAttachment(attachmentAccumulator);
  if (chunks.length === 0 && !subject && !attachment) {
    return null;
  }
  const isFile = Boolean(attachment);
  const isReply = Boolean(parentTxid);
  const normalizedMemo = memo.trim().toLowerCase();
  const bond =
    !isFile && !isReply && normalizedMemo === "powb"
      ? {
          contributionField: "infinityBondFlowSats",
          kind: "infinity-bond",
          tokenFamily: "POWB",
        }
      : !isFile && !isReply && normalizedMemo === "incb"
        ? {
            contributionField: "inceptionBondFlowSats",
            kind: "inception-bond",
            tokenFamily: "INCB",
          }
        : null;
  const html =
    isFile
      ? /^(?:text\/html|application\/xhtml\+xml)(?:$|[;\s])/iu.test(
          attachment.mime,
        )
      : isWorkAmoV5BrowserHtmlBody(memo);
  return {
    ...(attachment ? { attachment } : {}),
    ...(parentTxid ? { parentTxid } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(subject ? { subject } : {}),
    ...(bond ?? {}),
    contributionField:
      bond?.contributionField ??
      (html
        ? "browserFlowSats"
        : isFile
          ? "driveFlowSats"
          : "mailFlowSats"),
    kind:
      bond?.kind ??
      (isFile ? "file" : isReply ? "reply" : "mail"),
    memo,
  };
}

export function parseWorkAmoV5RawPwtRecord(payload) {
  const text = String(payload ?? "");
  if (!text.startsWith("pwt1:")) {
    return null;
  }
  const parts = text.slice(5).split(":");
  const txid = (value) => {
    const normalized = normalizedLowerText(value);
    return TXID_PATTERN.test(normalized) ? normalized : "";
  };
  if (parts.length === 6 && parts[0] === "create") {
    const ticker = String(parts[1] ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/gu, "")
      .slice(0, 12);
    const maxSupply = Number(parts[2]);
    const mintAmount = Number(parts[3]);
    const mintPriceSats = Number(parts[4]);
    const registryAddress = String(parts[5] ?? "").trim();
    return /^[A-Z0-9]{1,12}$/u.test(ticker) &&
      Number.isSafeInteger(maxSupply) &&
      maxSupply >= 1 &&
      Number.isSafeInteger(mintAmount) &&
      mintAmount >= 1 &&
      mintAmount <= maxSupply &&
      Number.isSafeInteger(mintPriceSats) &&
      mintPriceSats >= WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS &&
      isWorkAmoV5LivenetAddress(registryAddress)
      ? {
          kind: "create",
          maxSupply,
          mintAmount,
          mintPriceSats,
          payload: text,
          registryAddress,
          ticker,
        }
      : null;
  }
  if (parts.length === 3 && parts[0] === "mint") {
    const tokenId = txid(parts[1]);
    const amount = Number(parts[2]);
    if (!tokenId || !Number.isSafeInteger(amount) || amount < 1) {
      return null;
    }
    const amountAtoms =
      tokenId === WORK_TOKEN_ID
        ? BigInt(amount) * WORK_AMO_V5_ATOMS_PER_WORK
        : null;
    return amountAtoms === null ||
      amountAtoms <=
        WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK
      ? {
          amount,
          ...(amountAtoms === null
            ? {}
            : {
                amountAtoms: amountAtoms.toString(),
                amountVersion: "legacy-whole",
              }),
          kind: "mint",
          payload: text,
          tokenId,
        }
      : null;
  }
  if (
    parts.length === 4 &&
    (
      parts[0] === "send" ||
      parts[0] === "send2" ||
      parts[0] === "send3"
    )
  ) {
    const tokenId = txid(parts[1]);
    const recipientAddress = String(parts[3] ?? "").trim();
    const legacy = parts[0] === "send";
    const subatoms = parts[0] === "send3";
    const bond =
      tokenId === WORK_AMO_V5_POWB_TOKEN_ID ||
      tokenId === WORK_AMO_V5_INCB_TOKEN_ID;
    const exactAmount = bond
      ? canonicalUnsignedIntegerText(parts[2], { positive: true })
      : "";
    const amount = bond ? exactAmount : Number(parts[2]);
    const amountAtoms =
      tokenId === WORK_TOKEN_ID
        ? subatoms
          ? null
          : legacy &&
          Number.isSafeInteger(amount) &&
          amount >= 1
          ? BigInt(amount) * WORK_AMO_V5_ATOMS_PER_WORK
          : !legacy &&
              canonicalUnsignedIntegerText(parts[2], {
                positive: true,
              })
            ? BigInt(parts[2])
            : 0n
        : null;
    const amountSubatoms =
      tokenId === WORK_TOKEN_ID && subatoms
        ? canonicalUnsignedIntegerText(parts[2], {
            positive: true,
          })
        : "";
    if (
      !tokenId ||
      ((!legacy || subatoms) && tokenId !== WORK_TOKEN_ID) ||
      (legacy &&
        (bond
          ? !exactAmount
          : !Number.isSafeInteger(amount) || amount < 1)) ||
      (!legacy && !subatoms && amountAtoms === 0n) ||
      (subatoms &&
        (
          !amountSubatoms ||
          BigInt(amountSubatoms) >
            WORK_AMO_V5_MAX_SUPPLY * WORK_SUBATOM_UNIT_SCALE
        )) ||
      !isWorkAmoV5LivenetAddress(recipientAddress) ||
      (amountAtoms !== null &&
        (amountAtoms < 1n ||
          amountAtoms >
            WORK_AMO_V5_MAX_SUPPLY *
              WORK_AMO_V5_ATOMS_PER_WORK))
    ) {
      return null;
    }
    return {
      ...(legacy ? { amount } : {}),
      ...(amountAtoms === null
        ? {}
        : { amountAtoms: amountAtoms.toString() }),
      ...(amountSubatoms
        ? { amountSubatoms }
        : {}),
      amountVersion: parts[0],
      kind: "send",
      payload: text,
      recipientAddress,
      tokenId,
    };
  }
  if (parts.length === 2 && parts[0] === "list5") {
    const decoded = decodedWorkAmoV5Base64UrlJson(parts[1]);
    const saleAuthorization =
      decoded?.version === WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION
        ? parseWorkAmoV5GenericSaleAuthorization(decoded)
        : decoded;
    return TXID_PATTERN.test(
      normalizedLowerText(saleAuthorization?.tokenId),
    )
      ? { kind: "list", payload: text, saleAuthorization }
      : null;
  }
  if (
    parts.length === 3 &&
    parts[0] === "seal5" &&
    txid(parts[1])
  ) {
    const decoded = decodedWorkAmoV5Base64UrlJson(parts[2]);
    const saleAuthorization =
      decoded?.version === WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION
        ? parseWorkAmoV5GenericSaleAuthorization(decoded)
        : decoded;
    return TXID_PATTERN.test(
      normalizedLowerText(saleAuthorization?.tokenId),
    )
      ? {
          kind: "seal",
          listingId: txid(parts[1]),
          payload: text,
          saleAuthorization,
        }
      : null;
  }
  if (
    parts.length === 2 &&
    parts[0] === "delist5" &&
    txid(parts[1])
  ) {
    return {
      kind: "delist",
      listingId: txid(parts[1]),
      payload: text,
    };
  }
  if (
    (parts.length === 3 || parts.length === 4) &&
    parts[0] === "buy5" &&
    txid(parts[1]) &&
    isWorkAmoV5LivenetAddress(String(parts[2] ?? "").trim())
  ) {
    const decoded =
      parts.length === 4
        ? decodedWorkAmoV5Base64UrlJson(parts[3])
        : null;
    const saleAuthorization =
      decoded?.version === WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION
        ? parseWorkAmoV5GenericSaleAuthorization(decoded)
        : decoded;
    if (
      parts.length === 4 &&
      !TXID_PATTERN.test(
        normalizedLowerText(saleAuthorization?.tokenId),
      )
    ) {
      return null;
    }
    return {
      buyerAddress: String(parts[2]).trim(),
      kind: "buy",
      listingId: txid(parts[1]),
      payload: text,
      ...(saleAuthorization ? { saleAuthorization } : {}),
      ...(saleAuthorization?.tokenId
        ? {
            tokenId: normalizedLowerText(
              saleAuthorization.tokenId,
            ),
          }
        : {}),
    };
  }
  return null;
}

export function validateWorkAmoV5SaleTicketSignature({
  authorization,
  listingId,
  network = "livenet",
  unitPriceSats,
} = {}) {
  try {
    const normalizedListingId = normalizedTxid(listingId);
    const anchorTxid = normalizedTxid(authorization?.anchorTxid);
    const anchorVout = canonicalSafeInteger(authorization?.anchorVout);
    const anchorValueSats = canonicalSafeInteger(
      authorization?.anchorValueSats,
      { positive: true },
    );
    const priceSats = canonicalExactSafeInteger(unitPriceSats, {
      positive: true,
    });
    const sellerAddress = String(
      authorization?.sellerAddress ?? "",
    ).trim();
    const anchorScriptPubKey = normalizedLowerText(
      authorization?.anchorScriptPubKey,
    );
    const sellerPublicKey = normalizedLowerText(
      authorization?.sellerPublicKey,
    );
    const signatureHex = normalizedLowerText(
      authorization?.anchorSignature,
    );
    if (
      network !== "livenet" ||
      !normalizedListingId ||
      anchorTxid !== normalizedListingId ||
      anchorVout === null ||
      anchorValueSats === null ||
      priceSats === null ||
      authorization?.anchorSigHashType !== 0x83 ||
      !sellerAddress ||
      !/^(?:[0-9a-f]{2})+$/u.test(anchorScriptPubKey) ||
      !validPublicKeyHex(sellerPublicKey) ||
      !/^(?:[0-9a-f]{2})+$/u.test(signatureHex)
    ) {
      return invalid("work-amo-v5-sale-ticket-signature-shape-invalid");
    }
    const script = Buffer.from(anchorScriptPubKey, "hex");
    const expectedScript = bitcoin.address.toOutputScript(
      sellerAddress,
      bitcoin.networks.bitcoin,
    );
    if (!script.equals(expectedScript)) {
      return invalid("work-amo-v5-sale-ticket-seller-script-mismatch");
    }
    const transaction = new bitcoin.Transaction();
    transaction.version = 2;
    transaction.addInput(
      Buffer.from(normalizedListingId, "hex").reverse(),
      anchorVout,
      0xffffffff,
    );
    transaction.addOutput(
      expectedScript,
      BigInt(priceSats) + BigInt(anchorValueSats),
    );
    const signature = Buffer.from(signatureHex, "hex");
    if (signature.at(-1) !== 0x83) {
      return invalid("work-amo-v5-sale-ticket-sighash-invalid");
    }
    let verified = false;
    if (
      script.length === 34 &&
      script[0] === bitcoin.opcodes.OP_1 &&
      script[1] === 0x20
    ) {
      if (signature.length !== 65) {
        return invalid("work-amo-v5-sale-ticket-schnorr-shape-invalid");
      }
      const digest = transaction.hashForWitnessV1(
        0,
        [script],
        [BigInt(anchorValueSats)],
        0x83,
      );
      verified = ecc.verifySchnorr(
        digest,
        script.subarray(2),
        signature.subarray(0, 64),
      );
    } else {
      const publicKey = Buffer.from(sellerPublicKey, "hex");
      const expectedFromPublicKey =
        script.length === 22 &&
        script[0] === 0x00 &&
        script[1] === 0x14
          ? bitcoin.payments.p2wpkh({
              network: bitcoin.networks.bitcoin,
              pubkey: publicKey,
            }).output
          : bitcoin.payments.p2pkh({
              network: bitcoin.networks.bitcoin,
              pubkey: publicKey,
            }).output;
      if (
        !expectedFromPublicKey ||
        !Buffer.from(expectedFromPublicKey).equals(script)
      ) {
        return invalid(
          "work-amo-v5-sale-ticket-public-key-script-mismatch",
        );
      }
      const decoded = bitcoin.script.signature.decode(signature);
      if (decoded.hashType !== 0x83) {
        return invalid("work-amo-v5-sale-ticket-sighash-invalid");
      }
      const digest =
        script.length === 22
          ? transaction.hashForWitnessV0(
              0,
              bitcoin.payments.p2pkh({
                hash: script.subarray(2),
              }).output,
              BigInt(anchorValueSats),
              0x83,
            )
          : transaction.hashForSignature(0, script, 0x83);
      verified = ecc.verify(digest, publicKey, decoded.signature);
    }
    return verified
      ? { valid: true }
      : invalid("work-amo-v5-sale-ticket-signature-invalid");
  } catch {
    return invalid("work-amo-v5-sale-ticket-signature-invalid");
  }
}

export function validateWorkAmoUsdQuoteEvidence(
  evidence,
  { minimumBlockHeight = WORK_AMO_V5_V1_ACTIVATION_HEIGHT } = {},
) {
  if (evidence?.confirmed !== true || evidence?.canonical !== true) {
    return invalid("work-amo-v5-quote-unconfirmed");
  }
  const txid = normalizedTxid(evidence?.txid);
  if (!txid) {
    return invalid("work-amo-v5-quote-txid-invalid");
  }
  const position = normalizeWorkAmoCanonicalPosition(evidence);
  if (
    !position ||
    position.blockHeight <
      (canonicalSafeInteger(minimumBlockHeight, { positive: true }) ??
        WORK_AMO_V5_V1_ACTIVATION_HEIGHT)
  ) {
    return invalid("work-amo-v5-quote-position-unavailable");
  }
  const authorityScript = normalizedLowerText(
    evidence?.firstInputPrevoutScriptPubKey ??
      evidence?.inputZeroPrevoutScriptPubKey,
  );
  if (authorityScript !== WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY) {
    return invalid("work-amo-v5-quote-authority-invalid");
  }
  const recordCount = canonicalSafeInteger(
    evidence?.recordCount ?? evidence?.quoteRecordCount,
    { positive: true },
  );
  if (recordCount !== 1 || position.recordOrdinal !== 0) {
    return invalid("work-amo-v5-quote-record-count-invalid");
  }
  const registryAddress = String(evidence?.registryAddress ?? "").trim();
  const registryPaymentSats = canonicalSafeInteger(
    evidence?.registryPaymentSats,
  );
  if (
    registryAddress !== WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
    registryPaymentSats === null ||
    registryPaymentSats < WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS
  ) {
    return invalid("work-amo-v5-quote-registry-payment-insufficient");
  }
  const record = parseWorkAmoUsdQuoteRecord(
    evidence?.payload ?? evidence?.record,
  );
  if (!record) {
    return invalid("work-amo-v5-quote-payload-invalid");
  }
  return {
    quote: {
      ...position,
      previousQuoteTxid: record.previousQuoteTxid,
      sequence: record.sequence,
      txid,
      usdPer100mProofsQ8: record.usdPer100mProofsQ8,
      v1DeclarationTxid: record.v1DeclarationTxid,
    },
    valid: true,
  };
}

function normalizeCanonicalQuoteProjection(value) {
  const position = normalizeWorkAmoCanonicalPosition(value);
  const txid = normalizedTxid(value?.txid);
  const v1DeclarationTxid = normalizedTxid(
    value?.v1DeclarationTxid ?? value?.declarationTxid,
  );
  const previousQuoteTxid = normalizedTxid(value?.previousQuoteTxid);
  const sequence = canonicalUnsignedIntegerText(value?.sequence, {
    positive: true,
  });
  const usdPer100mProofsQ8 = canonicalUnsignedIntegerText(
    value?.usdPer100mProofsQ8,
    { positive: true },
  );
  if (
    !position ||
    position.recordOrdinal !== 0 ||
    !txid ||
    v1DeclarationTxid !== WORK_AMO_V5_V1_DECLARATION_TXID ||
    !previousQuoteTxid ||
    !sequence ||
    !usdPer100mProofsQ8
  ) {
    return null;
  }
  return {
    ...position,
    previousQuoteTxid,
    sequence,
    txid,
    usdPer100mProofsQ8,
    v1DeclarationTxid,
  };
}

function canonicalQuoteChainProjection(chain) {
  const normalized = [];
  let expectedSequence = 1n;
  let expectedPrevious = WORK_AMO_V5_V1_DECLARATION_TXID;
  for (const source of Array.isArray(chain) ? chain : []) {
    const quote = normalizeCanonicalQuoteProjection(source);
    if (
      !quote ||
      BigInt(quote.sequence) !== expectedSequence ||
      quote.previousQuoteTxid !== expectedPrevious ||
      (normalized.length > 0 &&
        !workAmoCanonicalPositionPrecedes(normalized.at(-1), quote))
    ) {
      return null;
    }
    normalized.push(quote);
    expectedSequence += 1n;
    expectedPrevious = quote.txid;
  }
  return normalized;
}

function sameCanonicalQuote(left, right) {
  return Boolean(
    left &&
      right &&
      left.txid === right.txid &&
      left.v1DeclarationTxid === right.v1DeclarationTxid &&
      left.previousQuoteTxid === right.previousQuoteTxid &&
      left.sequence === right.sequence &&
      left.usdPer100mProofsQ8 === right.usdPer100mProofsQ8 &&
      left.blockHash === right.blockHash &&
      compareWorkAmoCanonicalPositions(left, right) === 0,
  );
}

export function selectCanonicalWorkAmoUsdQuoteChain(
  evidences,
  options = {},
) {
  const rejected = [];
  const validatedByTxid = new Map();
  const inconsistentTxids = new Set();
  for (const evidence of Array.isArray(evidences) ? evidences : []) {
    const validation = validateWorkAmoUsdQuoteEvidence(evidence, options);
    if (!validation.valid) {
      rejected.push({
        reasonCode: validation.reasonCode,
        txid: normalizedTxid(evidence?.txid),
      });
      continue;
    }
    if (inconsistentTxids.has(validation.quote.txid)) {
      rejected.push({
        reasonCode: "work-amo-v5-quote-txid-inconsistent",
        txid: validation.quote.txid,
      });
      continue;
    }
    const existing = validatedByTxid.get(validation.quote.txid);
    if (existing && !sameCanonicalQuote(existing, validation.quote)) {
      validatedByTxid.delete(validation.quote.txid);
      inconsistentTxids.add(validation.quote.txid);
      rejected.push({
        reasonCode: "work-amo-v5-quote-txid-inconsistent",
        txid: validation.quote.txid,
      });
      continue;
    }
    if (existing) {
      rejected.push({
        reasonCode: "work-amo-v5-quote-evidence-duplicate",
        txid: validation.quote.txid,
      });
      continue;
    }
    validatedByTxid.set(validation.quote.txid, validation.quote);
  }

  const validated = [...validatedByTxid.values()];
  const hashesByHeight = new Map();
  for (const quote of validated) {
    const hashes = hashesByHeight.get(quote.blockHeight) ?? new Set();
    hashes.add(quote.blockHash);
    hashesByHeight.set(quote.blockHeight, hashes);
  }
  const conflictingHeights = new Set(
    [...hashesByHeight]
      .filter(([, hashes]) => hashes.size > 1)
      .map(([blockHeight]) => blockHeight),
  );
  if (conflictingHeights.size > 0) {
    for (const quote of validated) {
      if (conflictingHeights.has(quote.blockHeight)) {
        rejected.push({
          blockHeight: quote.blockHeight,
          reasonCode: "work-amo-v5-quote-canonical-fork-conflict",
          txid: quote.txid,
        });
      }
    }
    return {
      chain: [],
      head: null,
      reasonCode: "work-amo-v5-quote-canonical-fork-conflict",
      rejected,
      valid: false,
    };
  }
  const chain = [];
  const selectedTxids = new Set();
  let expectedSequence = 1n;
  let expectedPrevious = WORK_AMO_V5_V1_DECLARATION_TXID;
  let previous = null;
  for (;;) {
    const children = validated.filter(
      (quote) =>
        !selectedTxids.has(quote.txid) &&
        BigInt(quote.sequence) === expectedSequence &&
        quote.previousQuoteTxid === expectedPrevious &&
        (!previous || workAmoCanonicalPositionPrecedes(previous, quote)),
    );
    if (children.length === 0) {
      break;
    }
    children.sort(compareWorkAmoCanonicalPositions);
    if (
      children.length > 1 &&
      compareWorkAmoCanonicalPositions(children[0], children[1]) === 0
    ) {
      for (const child of children) {
        rejected.push({
          reasonCode: "work-amo-v5-quote-position-duplicate",
          txid: child.txid,
        });
        selectedTxids.add(child.txid);
      }
      break;
    }
    const winner = children[0];
    chain.push(winner);
    selectedTxids.add(winner.txid);
    for (const losingChild of children.slice(1)) {
      rejected.push({
        reasonCode: "work-amo-v5-quote-competing-child",
        txid: losingChild.txid,
        winnerTxid: winner.txid,
      });
      selectedTxids.add(losingChild.txid);
    }
    previous = winner;
    expectedPrevious = winner.txid;
    expectedSequence += 1n;
  }
  for (const quote of validated) {
    if (!selectedTxids.has(quote.txid)) {
      rejected.push({
        reasonCode: "work-amo-v5-quote-not-canonical-chain",
        txid: quote.txid,
      });
    }
  }
  return {
    chain,
    head: chain.at(-1) ?? null,
    rejected,
    valid: true,
  };
}

export function selectWorkAmoUsdQuoteBeforeListing(chain, listingPosition) {
  const listing = normalizeWorkAmoCanonicalPosition(listingPosition);
  const quotes = canonicalQuoteChainProjection(chain);
  if (!listing) {
    return invalid("work-amo-v5-listing-position-unavailable");
  }
  if (!quotes) {
    return invalid("work-amo-v5-quote-chain-invalid");
  }
  const quote = quotes
    .filter((candidate) =>
      workAmoCanonicalPositionPrecedes(candidate, listing),
    )
    .at(-1);
  if (!quote) {
    return invalid("work-amo-v5-quote-before-listing-unavailable");
  }
  if (
    listing.blockHeight > quote.blockHeight + WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS
  ) {
    return invalid("work-amo-v5-quote-expired", {
      maxQuoteAgeBlocks: WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
      quoteBlockHeight: quote.blockHeight,
    });
  }
  return { quote, valid: true };
}

function authorizationModelsValid(authorization) {
  return Object.entries(WORK_AMO_V5_MODELS).every(
    ([field, expected]) => authorization?.[field] === expected,
  );
}

function validOptionalTxid(value) {
  return value === undefined || value === null || value === ""
    ? true
    : Boolean(normalizedTxid(value));
}

function validOptionalHex(value) {
  return value === undefined || value === null || value === ""
    ? true
    : HEX_PATTERN.test(normalizedLowerText(value));
}

function validateWorkAmoV5StaticAuthorizationWithFace(
  authorization,
  {
    allowHistoricalFace = false,
    expectedFaceUsdCents = null,
  } = {},
) {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    Array.isArray(authorization)
  ) {
    return invalid("work-amo-v5-authorization-invalid");
  }
  if (authorization.version !== WORK_AMO_V5_AUTH_VERSION) {
    return invalid("work-amo-v5-version-required");
  }
  if (!authorizationModelsValid(authorization)) {
    return invalid("work-amo-v5-models-invalid");
  }
  const unitFaceUsdCents = canonicalSafeInteger(
    authorization.unitFaceUsdCents,
    { positive: true },
  );
  if (
    unitFaceUsdCents === null ||
    (!allowHistoricalFace &&
      !WORK_AMO_V5_ALLOWED_FACE_USD_CENTS.includes(unitFaceUsdCents)) ||
    (expectedFaceUsdCents !== null &&
      unitFaceUsdCents !== expectedFaceUsdCents)
  ) {
    return invalid("work-amo-v5-face-unit-invalid");
  }
  if (
    DERIVED_AUTHORIZATION_FIELDS.some(
      (field) =>
        authorization[field] !== undefined &&
        authorization[field] !== null &&
        authorization[field] !== "",
    )
  ) {
    return invalid("work-amo-v5-derived-fields-not-signable");
  }
  const tokenId = normalizedLowerText(authorization.tokenId);
  const ticker = String(authorization.ticker ?? "").trim().toUpperCase();
  const registryAddress = String(authorization.registryAddress ?? "").trim();
  const sellerAddress = String(authorization.sellerAddress ?? "").trim();
  const buyerAddress = String(authorization.buyerAddress ?? "").trim();
  const nonce = String(authorization.nonce ?? "").trim();
  const expiresAt = String(authorization.expiresAt ?? "").trim();
  const expiresAtMs = workAmoV5CanonicalExpiryMs(expiresAt);
  const anchorScriptPubKey = normalizedLowerText(
    authorization.anchorScriptPubKey,
  );
  const sellerPublicKey = normalizedLowerText(authorization.sellerPublicKey);
  if (
    tokenId !== WORK_TOKEN_ID ||
    ticker !== "WORK" ||
    authorization.network !== "livenet" ||
    registryAddress !== WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
    !isWorkAmoV5LivenetAddress(sellerAddress) ||
    (
      buyerAddress &&
      !isWorkAmoV5LivenetAddress(buyerAddress)
    ) ||
    !nonce ||
    nonce.length > 160 ||
    (expiresAt && !Number.isSafeInteger(expiresAtMs)) ||
    authorization.anchorType !== "sale-ticket-v1" ||
    authorization.anchorVout !== 2 ||
    authorization.anchorValueSats !== 546 ||
    authorization.anchorSigHashType !== 0x83 ||
    !HEX_PATTERN.test(anchorScriptPubKey) ||
    !PUBLIC_KEY_PATTERN.test(sellerPublicKey) ||
    !validOptionalTxid(authorization.anchorTxid) ||
    !validOptionalHex(authorization.anchorSignature)
  ) {
    return invalid("work-amo-v5-static-fields-invalid");
  }
  return {
    authorization: {
      ...WORK_AMO_V5_MODELS,
      anchorScriptPubKey,
      anchorSigHashType: 0x83,
      anchorType: "sale-ticket-v1",
      anchorValueSats: 546,
      anchorVout: 2,
      buyerAddress,
      expiresAt,
      network: "livenet",
      nonce,
      registryAddress,
      sellerAddress,
      sellerPublicKey,
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
      unitFaceUsdCents,
      version: WORK_AMO_V5_AUTH_VERSION,
      ...(authorization.anchorTxid
        ? { anchorTxid: normalizedTxid(authorization.anchorTxid) }
        : {}),
      ...(authorization.anchorSignature
        ? {
            anchorSignature: normalizedLowerText(
              authorization.anchorSignature,
            ),
          }
        : {}),
    },
    valid: true,
  };
}

export function validateWorkAmoV5StaticAuthorization(authorization) {
  return validateWorkAmoV5StaticAuthorizationWithFace(authorization);
}

function workAmoReferenceIdentityMatches(
  normalizedReference,
  listingAuthorization,
) {
  return Boolean(
    normalizedReference &&
      listingAuthorization &&
      normalizedLowerText(listingAuthorization.tokenId) ===
        normalizedReference.tokenId &&
      String(listingAuthorization.ticker ?? "").trim().toUpperCase() ===
        normalizedReference.ticker &&
      listingAuthorization.network === normalizedReference.network &&
      String(listingAuthorization.registryAddress ?? "").trim() ===
        normalizedReference.registryAddress &&
      String(listingAuthorization.sellerAddress ?? "").trim() ===
        normalizedReference.sellerAddress &&
      String(listingAuthorization.buyerAddress ?? "").trim() ===
        normalizedReference.buyerAddress &&
      String(listingAuthorization.expiresAt ?? "").trim() ===
        normalizedReference.expiresAt &&
      String(listingAuthorization.nonce ?? "").trim() ===
        normalizedReference.nonce &&
      normalizedLowerText(listingAuthorization.anchorScriptPubKey) ===
        normalizedReference.anchorScriptPubKey &&
      listingAuthorization.anchorSigHashType ===
        normalizedReference.anchorSigHashType &&
      listingAuthorization.anchorType === normalizedReference.anchorType &&
      listingAuthorization.anchorValueSats ===
        normalizedReference.anchorValueSats &&
      listingAuthorization.anchorVout === normalizedReference.anchorVout &&
      normalizedLowerText(listingAuthorization.sellerPublicKey) ===
        normalizedReference.sellerPublicKey,
  );
}

function historicalV4ListingPosition(frozenTerms) {
  return normalizeWorkAmoCanonicalPosition({
    blockHash:
      frozenTerms?.listingBlockHash ?? frozenTerms?.blockHash,
    blockHeight:
      frozenTerms?.listingBlockHeight ?? frozenTerms?.blockHeight,
    blockTransactionIndex:
      frozenTerms?.listingBlockIndex ?? frozenTerms?.blockTransactionIndex,
    protocolVout:
      frozenTerms?.listingProtocolVout ?? frozenTerms?.protocolVout,
    recordOrdinal:
      frozenTerms?.listingRecordOrdinal ?? frozenTerms?.recordOrdinal,
  });
}

export function validateWorkAmoV5ReferencedAuthorization(
  authorization,
  {
    listingAuthorization = null,
    listingFrozenTerms = null,
  } = {},
) {
  if (
    !listingAuthorization ||
    !listingFrozenTerms ||
    typeof listingAuthorization !== "object" ||
    Array.isArray(listingAuthorization) ||
    typeof listingFrozenTerms !== "object" ||
    Array.isArray(listingFrozenTerms)
  ) {
    return invalid("work-amo-v5-reference-listing-unavailable");
  }
  if (listingAuthorization.version !== WORK_AMO_V4_AUTH_VERSION) {
    return invalid("work-amo-v5-reference-listing-version-invalid");
  }
  if (
    listingFrozenTerms.canonical !== true ||
    listingFrozenTerms.confirmed !== true ||
    listingFrozenTerms.valid !== true
  ) {
    return invalid("work-amo-v5-reference-listing-not-canonical");
  }
  const frozenAuthorizationVersion = String(
    listingFrozenTerms.authorizationVersion ??
      listingFrozenTerms.version ??
      "",
  ).trim();
  if (frozenAuthorizationVersion !== WORK_AMO_V4_AUTH_VERSION) {
    return invalid("work-amo-v5-reference-frozen-version-invalid");
  }
  const listingFaceUsdCents = canonicalSafeInteger(
    listingAuthorization.unitFaceUsdCents,
    { positive: true },
  );
  const frozenFaceUsdCents = canonicalSafeInteger(
    listingFrozenTerms.unitFaceUsdCents,
    { positive: true },
  );
  const frozenFaceUsd = canonicalSafeInteger(
    listingFrozenTerms.unitFaceUsd,
    { positive: true },
  );
  if (
    !WORK_AMO_V4_HISTORICAL_FACE_USD_CENTS.includes(
      listingFaceUsdCents,
    ) ||
    frozenFaceUsdCents !== listingFaceUsdCents ||
    frozenFaceUsd !== listingFaceUsdCents / 100
  ) {
    return invalid("work-amo-v5-reference-historical-face-invalid");
  }
  const referenceValidation =
    validateWorkAmoV5StaticAuthorizationWithFace(authorization, {
      allowHistoricalFace: true,
      expectedFaceUsdCents: listingFaceUsdCents,
    });
  if (!referenceValidation.valid) {
    return referenceValidation.reasonCode ===
      "work-amo-v5-face-unit-invalid"
      ? invalid("work-amo-v5-reference-face-mismatch")
      : referenceValidation;
  }
  if (
    !workAmoReferenceIdentityMatches(
      referenceValidation.authorization,
      listingAuthorization,
    )
  ) {
    return invalid("work-amo-v5-reference-identity-mismatch");
  }
  const listingPosition = historicalV4ListingPosition(
    listingFrozenTerms,
  );
  if (
    !listingPosition ||
    listingPosition.blockHeight < WORK_AMO_V5_V1_ACTIVATION_HEIGHT ||
    listingPosition.blockHeight >= WORK_AMO_V5_ACTIVATION_HEIGHT
  ) {
    return invalid("work-amo-v5-reference-listing-position-invalid");
  }
  const amount = positiveBigInt(listingFrozenTerms.unitAmountAtoms);
  const price = positiveBigInt(listingFrozenTerms.unitPriceSats);
  const minimum = positiveBigInt(
    listingFrozenTerms.unitMinimumPriceSats,
  );
  const networkValue = positiveBigInt(
    listingFrozenTerms.unitNetworkValueBeforeQ8 ??
      listingFrozenTerms.unitNetworkValueQ8,
  );
  const listingAmount = positiveBigInt(
    listingAuthorization.unitAmountAtoms ??
      listingAuthorization.amountAtoms,
  );
  const listingTransferAmount = positiveBigInt(
    listingAuthorization.amountAtoms,
  );
  const listingPrice = positiveBigInt(
    listingAuthorization.unitPriceSats ??
      listingAuthorization.priceSats,
  );
  const listingSalePrice = positiveBigInt(
    listingAuthorization.priceSats,
  );
  const listingMinimum = positiveBigInt(
    listingAuthorization.unitMinimumPriceSats ??
      listingAuthorization.minimumPriceSats,
  );
  const listingNetworkValue = positiveBigInt(
    listingAuthorization.unitNetworkValueQ8,
  );
  if (
    normalizedLowerText(listingFrozenTerms.tokenId) !== WORK_TOKEN_ID ||
    listingAuthorization.unitModel !== WORK_AMO_V4_UNIT_MODEL ||
    listingAuthorization.unitUsdOracleModel !==
      WORK_AMO_V5_UNIT_USD_ORACLE_MODEL ||
    listingAuthorization.oracleModel !== WORK_AMO_V4_ORACLE_MODEL ||
    canonicalSafeInteger(listingAuthorization.unitFaceUsd, {
      positive: true,
    }) !==
      listingFaceUsdCents / 100 ||
    amount === null ||
    price === null ||
    minimum === null ||
    networkValue === null ||
    listingAmount !== amount ||
    listingTransferAmount !== amount ||
    listingPrice !== price ||
    listingSalePrice !== price ||
    listingMinimum !== minimum ||
    listingNetworkValue !== networkValue ||
    price < minimum
  ) {
    return invalid("work-amo-v5-reference-frozen-terms-invalid");
  }
  return {
    authorization: referenceValidation.authorization,
    grandfathered: true,
    listingAuthorizationVersion: WORK_AMO_V4_AUTH_VERSION,
    listingFaceUsdCents,
    listingFrozenTerms: {
      authorizationVersion: WORK_AMO_V4_AUTH_VERSION,
      listingBlockHash: listingPosition.blockHash,
      listingBlockHeight: listingPosition.blockHeight,
      listingBlockIndex: listingPosition.blockTransactionIndex,
      listingProtocolVout: listingPosition.protocolVout,
      listingRecordOrdinal: listingPosition.recordOrdinal,
      tokenId: WORK_TOKEN_ID,
      unitAmountAtoms: amount.toString(),
      unitFaceUsd: frozenFaceUsd,
      unitFaceUsdCents: frozenFaceUsdCents,
      unitMinimumPriceSats: minimum.toString(),
      unitNetworkValueBeforeQ8: networkValue.toString(),
      unitPriceSats: price.toString(),
    },
    valid: true,
  };
}

export function workAmoV5CanonicalHistoricalV4ListingWitness(
  authorization,
  frozenTerms,
) {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    Array.isArray(authorization)
  ) {
    return null;
  }
  const reference = {
    ...WORK_AMO_V5_MODELS,
    anchorScriptPubKey: authorization.anchorScriptPubKey,
    anchorSigHashType: authorization.anchorSigHashType,
    anchorType: authorization.anchorType,
    anchorValueSats: authorization.anchorValueSats,
    anchorVout: authorization.anchorVout,
    buyerAddress: authorization.buyerAddress,
    expiresAt: authorization.expiresAt,
    network: authorization.network,
    nonce: authorization.nonce,
    registryAddress: authorization.registryAddress,
    sellerAddress: authorization.sellerAddress,
    sellerPublicKey: authorization.sellerPublicKey,
    ticker: authorization.ticker,
    tokenId: authorization.tokenId,
    unitFaceUsdCents: authorization.unitFaceUsdCents,
    version: WORK_AMO_V5_AUTH_VERSION,
    ...(authorization.anchorTxid
      ? { anchorTxid: authorization.anchorTxid }
      : {}),
    ...(authorization.anchorSignature
      ? { anchorSignature: authorization.anchorSignature }
      : {}),
  };
  const validation = validateWorkAmoV5ReferencedAuthorization(
    reference,
    { listingAuthorization: authorization, listingFrozenTerms: frozenTerms },
  );
  if (!validation.valid) {
    return null;
  }
  const normalizedReference = validation.authorization;
  const normalizedFrozen = validation.listingFrozenTerms;
  const saleAuthorization = {
    anchorScriptPubKey: normalizedReference.anchorScriptPubKey,
    anchorSigHashType: normalizedReference.anchorSigHashType,
    anchorType: normalizedReference.anchorType,
    anchorValueSats: normalizedReference.anchorValueSats,
    anchorVout: normalizedReference.anchorVout,
    amountAtoms: normalizedFrozen.unitAmountAtoms,
    buyerAddress: normalizedReference.buyerAddress,
    expiresAt: normalizedReference.expiresAt,
    minimumPriceSats: normalizedFrozen.unitMinimumPriceSats,
    network: normalizedReference.network,
    nonce: normalizedReference.nonce,
    oracleModel: WORK_AMO_V4_ORACLE_MODEL,
    priceSats: normalizedFrozen.unitPriceSats,
    registryAddress: normalizedReference.registryAddress,
    sellerAddress: normalizedReference.sellerAddress,
    sellerPublicKey: normalizedReference.sellerPublicKey,
    ticker: normalizedReference.ticker,
    tokenId: normalizedReference.tokenId,
    unitAmountAtoms: normalizedFrozen.unitAmountAtoms,
    unitFaceUsd: validation.listingFaceUsdCents / 100,
    unitFaceUsdCents: validation.listingFaceUsdCents,
    unitMinimumPriceSats: normalizedFrozen.unitMinimumPriceSats,
    unitModel: WORK_AMO_V4_UNIT_MODEL,
    unitNetworkValueQ8: normalizedFrozen.unitNetworkValueBeforeQ8,
    unitPriceSats: normalizedFrozen.unitPriceSats,
    unitUsdOracleModel: WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
    version: WORK_AMO_V4_AUTH_VERSION,
    ...(normalizedReference.anchorTxid
      ? { anchorTxid: normalizedReference.anchorTxid }
      : {}),
    ...(normalizedReference.anchorSignature
      ? { anchorSignature: normalizedReference.anchorSignature }
      : {}),
  };
  return {
    frozenTerms: {
      authorizationVersion: WORK_AMO_V4_AUTH_VERSION,
      canonical: true,
      confirmed: true,
      ...normalizedFrozen,
      valid: true,
    },
    saleAuthorization,
  };
}

export function workAmoCeilDiv(numerator, denominator) {
  if (
    typeof numerator !== "bigint" ||
    typeof denominator !== "bigint" ||
    numerator < 0n ||
    denominator <= 0n
  ) {
    throw new RangeError("AMO ceilDiv requires unsigned BigInt operands.");
  }
  return (numerator + denominator - 1n) / denominator;
}

export function workAmoFloorDiv(numerator, denominator) {
  if (
    typeof numerator !== "bigint" ||
    typeof denominator !== "bigint" ||
    numerator < 0n ||
    denominator <= 0n
  ) {
    throw new RangeError("AMO floorDiv requires unsigned BigInt operands.");
  }
  return numerator / denominator;
}

export function workAmoV5UnitTerms({
  networkValueBeforeQ8,
  unitFaceUsdCents,
  usdPer100mProofsQ8,
} = {}) {
  const face = canonicalSafeInteger(unitFaceUsdCents, { positive: true });
  const priceQuote = positiveBigInt(usdPer100mProofsQ8);
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (!WORK_AMO_V5_ALLOWED_FACE_USD_CENTS.includes(face)) {
    return invalid("work-amo-v5-face-unit-invalid");
  }
  if (priceQuote === null) {
    return invalid("work-amo-v5-usd-quote-value-invalid");
  }
  if (networkValue === null) {
    return invalid("work-amo-v5-network-value-before-invalid");
  }
  const targetNumerator =
    BigInt(face) *
    WORK_AMO_V5_PROOFS_PER_QUOTE_UNIT *
    WORK_AMO_V5_USD_QUOTE_Q8_SCALE;
  const targetDenominator = 100n * priceQuote;
  const unitPriceSats = workAmoCeilDiv(targetNumerator, targetDenominator);
  const unitAmountAtoms = workAmoFloorDiv(
    targetNumerator *
      WORK_AMO_V5_MAX_SUPPLY *
      WORK_AMO_V5_ATOMS_PER_WORK *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
    targetDenominator * networkValue,
  );
  const unitMinimumPriceSats = workAmoCeilDiv(
    unitAmountAtoms * networkValue,
    WORK_AMO_V5_MAX_SUPPLY *
      WORK_AMO_V5_ATOMS_PER_WORK *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  );
  if (
    unitPriceSats <= 0n ||
    unitAmountAtoms <= 0n ||
    unitMinimumPriceSats <= 0n
  ) {
    return invalid("work-amo-v5-unit-result-nonpositive");
  }
  if (unitPriceSats < unitMinimumPriceSats) {
    return invalid("work-amo-v5-unit-price-below-minimum");
  }
  return {
    targetDenominator: targetDenominator.toString(),
    targetNumerator: targetNumerator.toString(),
    unitAmountAtoms: unitAmountAtoms.toString(),
    unitMinimumPriceSats: unitMinimumPriceSats.toString(),
    unitPriceSats: unitPriceSats.toString(),
    valid: true,
  };
}

export const calculateWorkAmoV5UnitTerms = workAmoV5UnitTerms;

function quotePrecedesListingAndIsFresh(quote, listing) {
  if (!workAmoCanonicalPositionPrecedes(quote, listing)) {
    return invalid("work-amo-v5-quote-not-before-listing");
  }
  if (
    listing.blockHeight > quote.blockHeight + WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS
  ) {
    return invalid("work-amo-v5-quote-expired");
  }
  return { valid: true };
}

export function deriveWorkAmoV5FrozenTerms(
  authorization,
  {
    listingBondContributionQ8,
    listingPosition,
    networkValueBeforeQ8,
    quote,
    spendableAmountAtoms,
  } = {},
) {
  const staticValidation =
    validateWorkAmoV5StaticAuthorization(authorization);
  if (!staticValidation.valid) {
    return staticValidation;
  }
  const listing = normalizeWorkAmoCanonicalPosition(listingPosition);
  if (!listing) {
    return invalid("work-amo-v5-listing-position-unavailable");
  }
  if (listing.blockHeight < WORK_AMO_V5_ACTIVATION_HEIGHT) {
    return invalid("work-amo-v5-listing-before-activation");
  }
  const normalizedQuote = normalizeCanonicalQuoteProjection(quote);
  if (!normalizedQuote) {
    return invalid("work-amo-v5-quote-before-listing-unavailable");
  }
  if (normalizedQuote.blockHeight < WORK_AMO_V5_V1_ACTIVATION_HEIGHT) {
    return invalid("work-amo-v5-quote-before-v1-activation");
  }
  const quoteOrder = quotePrecedesListingAndIsFresh(normalizedQuote, listing);
  if (!quoteOrder.valid) {
    return quoteOrder;
  }
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (networkValue === null) {
    return invalid("work-amo-v5-network-value-before-invalid");
  }
  const bondContribution = positiveBigInt(listingBondContributionQ8);
  if (bondContribution === null) {
    return invalid("work-amo-v5-listing-bond-contribution-invalid");
  }
  const unit = workAmoV5UnitTerms({
    networkValueBeforeQ8: networkValue.toString(),
    unitFaceUsdCents:
      staticValidation.authorization.unitFaceUsdCents,
    usdPer100mProofsQ8: normalizedQuote.usdPer100mProofsQ8,
  });
  if (!unit.valid) {
    return unit;
  }
  const spendable = nonNegativeBigInt(spendableAmountAtoms);
  if (spendable === null) {
    return invalid("work-amo-v5-spendable-balance-unavailable");
  }
  if (spendable < BigInt(unit.unitAmountAtoms)) {
    return invalid("work-amo-v5-insufficient-spendable-balance", {
      requiredAmountAtoms: unit.unitAmountAtoms,
      spendableAmountAtoms: spendable.toString(),
    });
  }
  const networkAfter = networkValue + bondContribution;
  const frozenTerms = {
    ...WORK_AMO_V5_MODELS,
    listingBlockHash: listing.blockHash,
    listingBlockHeight: listing.blockHeight,
    listingBlockIndex: listing.blockTransactionIndex,
    listingBondContributionQ8: bondContribution.toString(),
    listingProtocolVout: listing.protocolVout,
    listingRecordOrdinal: listing.recordOrdinal,
    unitAmountAtoms: unit.unitAmountAtoms,
    unitFaceUsd:
      staticValidation.authorization.unitFaceUsdCents / 100,
    unitFaceUsdCents:
      staticValidation.authorization.unitFaceUsdCents,
    unitMinimumPriceSats: unit.unitMinimumPriceSats,
    unitNetworkValueAfterQ8: networkAfter.toString(),
    unitNetworkValueBeforeQ8: networkValue.toString(),
    unitPriceSats: unit.unitPriceSats,
    unitUsdPer100mProofsQ8: normalizedQuote.usdPer100mProofsQ8,
    unitUsdQuoteBlockHash: normalizedQuote.blockHash,
    unitUsdQuoteBlockHeight: normalizedQuote.blockHeight,
    unitUsdQuoteBlockIndex: normalizedQuote.blockTransactionIndex,
    unitUsdQuoteSequence: normalizedQuote.sequence,
    unitUsdQuoteTxid: normalizedQuote.txid,
    unitUsdQuoteVout: normalizedQuote.protocolVout,
    version: WORK_AMO_V5_AUTH_VERSION,
  };
  return { frozenTerms, valid: true };
}

function normalizeFrozenQuoteProjection(value) {
  const position = normalizeWorkAmoCanonicalPosition({
    blockHash: value?.unitUsdQuoteBlockHash,
    blockHeight: value?.unitUsdQuoteBlockHeight,
    blockTransactionIndex: value?.unitUsdQuoteBlockIndex,
    protocolVout: value?.unitUsdQuoteVout,
    recordOrdinal: 0,
  });
  const txid = normalizedTxid(value?.unitUsdQuoteTxid);
  const sequence = canonicalUnsignedIntegerText(value?.unitUsdQuoteSequence, {
    positive: true,
  });
  const usdPer100mProofsQ8 = canonicalUnsignedIntegerText(
    value?.unitUsdPer100mProofsQ8,
    { positive: true },
  );
  if (!position || !txid || !sequence || !usdPer100mProofsQ8) {
    return null;
  }
  return {
    ...position,
    sequence,
    txid,
    usdPer100mProofsQ8,
  };
}

function normalizeWorkAmoV5FrozenTerms(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (
    value.version !== WORK_AMO_V5_AUTH_VERSION ||
    !authorizationModelsValid(value)
  ) {
    return null;
  }
  const unitFaceUsdCents = canonicalSafeInteger(value.unitFaceUsdCents, {
    positive: true,
  });
  const unitFaceUsd = canonicalSafeInteger(value.unitFaceUsd, {
    positive: true,
  });
  if (
    !WORK_AMO_V5_ALLOWED_FACE_USD_CENTS.includes(unitFaceUsdCents) ||
    unitFaceUsd !== unitFaceUsdCents / 100
  ) {
    return null;
  }
  const listingPosition = normalizeWorkAmoCanonicalPosition({
    blockHash: value.listingBlockHash,
    blockHeight: value.listingBlockHeight,
    blockTransactionIndex: value.listingBlockIndex,
    protocolVout: value.listingProtocolVout,
    recordOrdinal: value.listingRecordOrdinal,
  });
  const quote = normalizeFrozenQuoteProjection(value);
  const networkBefore = positiveBigInt(value.unitNetworkValueBeforeQ8);
  const amount = positiveBigInt(value.unitAmountAtoms);
  const price = positiveBigInt(value.unitPriceSats);
  const minimum = positiveBigInt(value.unitMinimumPriceSats);
  const bond = positiveBigInt(value.listingBondContributionQ8);
  const networkAfter = positiveBigInt(value.unitNetworkValueAfterQ8);
  if (
    !listingPosition ||
    listingPosition.blockHeight < WORK_AMO_V5_ACTIVATION_HEIGHT ||
    !quote ||
    quote.blockHeight < WORK_AMO_V5_V1_ACTIVATION_HEIGHT ||
    networkBefore === null ||
    amount === null ||
    price === null ||
    minimum === null ||
    bond === null ||
    networkAfter === null ||
    !quotePrecedesListingAndIsFresh(quote, listingPosition).valid ||
    networkAfter !== networkBefore + bond
  ) {
    return null;
  }
  const unit = workAmoV5UnitTerms({
    networkValueBeforeQ8: networkBefore.toString(),
    unitFaceUsdCents,
    usdPer100mProofsQ8: quote.usdPer100mProofsQ8,
  });
  if (
    !unit.valid ||
    unit.unitAmountAtoms !== amount.toString() ||
    unit.unitPriceSats !== price.toString() ||
    unit.unitMinimumPriceSats !== minimum.toString()
  ) {
    return null;
  }
  return {
    ...WORK_AMO_V5_MODELS,
    listingBlockHash: listingPosition.blockHash,
    listingBlockHeight: listingPosition.blockHeight,
    listingBlockIndex: listingPosition.blockTransactionIndex,
    listingBondContributionQ8: bond.toString(),
    listingProtocolVout: listingPosition.protocolVout,
    listingRecordOrdinal: listingPosition.recordOrdinal,
    unitAmountAtoms: amount.toString(),
    unitFaceUsd,
    unitFaceUsdCents,
    unitMinimumPriceSats: minimum.toString(),
    unitNetworkValueAfterQ8: networkAfter.toString(),
    unitNetworkValueBeforeQ8: networkBefore.toString(),
    unitPriceSats: price.toString(),
    unitUsdPer100mProofsQ8: quote.usdPer100mProofsQ8,
    unitUsdQuoteBlockHash: quote.blockHash,
    unitUsdQuoteBlockHeight: quote.blockHeight,
    unitUsdQuoteBlockIndex: quote.blockTransactionIndex,
    unitUsdQuoteSequence: quote.sequence,
    unitUsdQuoteTxid: quote.txid,
    unitUsdQuoteVout: quote.protocolVout,
    version: WORK_AMO_V5_AUTH_VERSION,
  };
}

function samePosition(left, right) {
  const normalizedLeft = normalizeWorkAmoCanonicalPosition(left);
  const normalizedRight = normalizeWorkAmoCanonicalPosition(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft.blockHash === normalizedRight.blockHash &&
      compareWorkAmoCanonicalPositions(normalizedLeft, normalizedRight) === 0,
  );
}

export function validateWorkAmoV5FrozenTerms(
  frozenTerms,
  {
    authorization = null,
    listingBondContributionQ8,
    listingPosition = null,
    networkValueBeforeQ8,
    quote = null,
  } = {},
) {
  const normalized = normalizeWorkAmoV5FrozenTerms(frozenTerms);
  if (!normalized) {
    return invalid("work-amo-v5-frozen-terms-invalid");
  }
  if (authorization) {
    const staticValidation =
      validateWorkAmoV5StaticAuthorization(authorization);
    if (
      !staticValidation.valid ||
      normalized.unitFaceUsdCents !==
        staticValidation.authorization.unitFaceUsdCents
    ) {
      return invalid("work-amo-v5-frozen-authorization-mismatch");
    }
  }
  if (
    listingPosition &&
    !samePosition(listingPosition, {
      blockHash: normalized.listingBlockHash,
      blockHeight: normalized.listingBlockHeight,
      blockTransactionIndex: normalized.listingBlockIndex,
      protocolVout: normalized.listingProtocolVout,
      recordOrdinal: normalized.listingRecordOrdinal,
    })
  ) {
    return invalid("work-amo-v5-frozen-listing-position-mismatch");
  }
  const expectedNetwork = networkValueBeforeQ8 === undefined
    ? ""
    : canonicalUnsignedIntegerText(networkValueBeforeQ8, { positive: true });
  if (
    networkValueBeforeQ8 !== undefined &&
    expectedNetwork !== normalized.unitNetworkValueBeforeQ8
  ) {
    return invalid("work-amo-v5-frozen-network-value-mismatch");
  }
  const expectedBond = listingBondContributionQ8 === undefined
    ? ""
    : canonicalUnsignedIntegerText(listingBondContributionQ8);
  if (
    listingBondContributionQ8 !== undefined &&
    expectedBond !== normalized.listingBondContributionQ8
  ) {
    return invalid("work-amo-v5-frozen-bond-contribution-mismatch");
  }
  if (quote) {
    const expectedQuote = normalizeCanonicalQuoteProjection(quote);
    if (
      !expectedQuote ||
      expectedQuote.txid !== normalized.unitUsdQuoteTxid ||
      expectedQuote.protocolVout !== normalized.unitUsdQuoteVout ||
      expectedQuote.sequence !== normalized.unitUsdQuoteSequence ||
      expectedQuote.blockHeight !== normalized.unitUsdQuoteBlockHeight ||
      expectedQuote.blockHash !== normalized.unitUsdQuoteBlockHash ||
      expectedQuote.blockTransactionIndex !==
        normalized.unitUsdQuoteBlockIndex ||
      expectedQuote.recordOrdinal !== 0 ||
      expectedQuote.usdPer100mProofsQ8 !==
        normalized.unitUsdPer100mProofsQ8
    ) {
      return invalid("work-amo-v5-frozen-quote-mismatch");
    }
  }
  return { frozenTerms: normalized, valid: true };
}

export function workAmoV5FrozenTermsMatch(left, right) {
  const normalizedLeft = normalizeWorkAmoV5FrozenTerms(left);
  const normalizedRight = normalizeWorkAmoV5FrozenTerms(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      WORK_AMO_V5_FROZEN_TERM_FIELDS.every(
        (field) => normalizedLeft[field] === normalizedRight[field],
      ),
  );
}

export function validateWorkAmoV5SealOrBuyTerms({
  actionFrozenTerms = null,
  actionPosition,
  listingFrozenTerms,
  listingPosition,
  referencesListingFrozenTerms = false,
} = {}) {
  const listingValidation =
    validateWorkAmoV5FrozenTerms(listingFrozenTerms, { listingPosition });
  if (!listingValidation.valid) {
    return listingValidation;
  }
  const normalizedListingPosition = normalizeWorkAmoCanonicalPosition(
    listingPosition ?? {
      blockHash: listingValidation.frozenTerms.listingBlockHash,
      blockHeight: listingValidation.frozenTerms.listingBlockHeight,
      blockTransactionIndex:
        listingValidation.frozenTerms.listingBlockIndex,
      protocolVout: listingValidation.frozenTerms.listingProtocolVout,
      recordOrdinal: listingValidation.frozenTerms.listingRecordOrdinal,
    },
  );
  const normalizedActionPosition =
    normalizeWorkAmoCanonicalPosition(actionPosition);
  if (
    !normalizedListingPosition ||
    !normalizedActionPosition ||
    !workAmoCanonicalPositionPrecedes(
      normalizedListingPosition,
      normalizedActionPosition,
    )
  ) {
    return invalid("work-amo-v5-action-not-after-listing");
  }
  if (referencesListingFrozenTerms === true && !actionFrozenTerms) {
    return {
      frozenTerms: listingValidation.frozenTerms,
      referenced: true,
      valid: true,
    };
  }
  if (
    !actionFrozenTerms ||
    !workAmoV5FrozenTermsMatch(
      listingValidation.frozenTerms,
      actionFrozenTerms,
    )
  ) {
    return invalid("work-amo-v5-action-frozen-terms-mismatch");
  }
  return {
    frozenTerms: listingValidation.frozenTerms,
    referenced: false,
    valid: true,
  };
}

function sequencerFailure(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = detail;
  throw error;
}

function sequencerNetworkValueQ8(state, valueFromState) {
  let value;
  try {
    value = valueFromState(state);
  } catch (error) {
    sequencerFailure("work-amo-v5-sequencer-value-unavailable", {
      cause: String(error?.message ?? error),
    });
  }
  const text = canonicalUnsignedIntegerText(value);
  if (!text) {
    sequencerFailure("work-amo-v5-sequencer-value-unavailable");
  }
  return BigInt(text);
}

function sequencerClone(value) {
  try {
    return structuredClone(value);
  } catch (error) {
    sequencerFailure("work-amo-v5-sequencer-state-not-cloneable", {
      cause: String(error?.message ?? error),
    });
  }
}

function canonicalBuiltinPrototype(value, name) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) {
    return name === "Object";
  }
  const constructorDescriptor =
    Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (
    !constructorDescriptor ||
    !Object.hasOwn(constructorDescriptor, "value") ||
    typeof constructorDescriptor.value !== "function" ||
    constructorDescriptor.value.name !== name
  ) {
    return false;
  }
  if (name === "Object") {
    return Object.getPrototypeOf(prototype) === null;
  }
  const objectPrototype = Object.getPrototypeOf(prototype);
  return Boolean(
    objectPrototype &&
      Object.getPrototypeOf(objectPrototype) === null,
  );
}

function canonicalStateJsonValue(value, seen) {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      !Number.isSafeInteger(value) ||
      Object.is(value, -0)
    ) {
      throw new TypeError(
        "Canonical AMO sufficient state contains a non-integer number.",
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    const ownNames = Object.getOwnPropertyNames(value);
    const enumerableKeys = Object.keys(value);
    if (
      !canonicalBuiltinPrototype(value, "Array") ||
      Object.getOwnPropertySymbols(value).length !== 0 ||
      ownNames.length !== value.length + 1 ||
      enumerableKeys.length !== value.length
    ) {
      throw new TypeError(
        "Canonical AMO sufficient state contains a sparse or decorated array.",
      );
    }
    if (seen.has(value)) {
      throw new TypeError("Canonical AMO sufficient state is cyclic.");
    }
    seen.add(value);
    const normalized = [];
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")
      ) {
        seen.delete(value);
        throw new TypeError(
          "Canonical AMO sufficient state contains a sparse or decorated array.",
        );
      }
      normalized.push(
        canonicalStateJsonValue(descriptor.value, seen),
      );
    }
    seen.delete(value);
    return normalized;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (
      !canonicalBuiltinPrototype(value, "Object") ||
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.getOwnPropertyNames(value).length !== keys.length ||
      keys.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor || !Object.hasOwn(descriptor, "value");
      })
    ) {
      throw new TypeError(
        "Canonical AMO sufficient state contains an unsupported object.",
      );
    }
    if (seen.has(value)) {
      throw new TypeError("Canonical AMO sufficient state is cyclic.");
    }
    seen.add(value);
    const normalized = {};
    for (const key of keys.sort(compareWorkAmoUtf8)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      Object.defineProperty(normalized, key, {
        configurable: true,
        enumerable: true,
        value: canonicalStateJsonValue(descriptor.value, seen),
        writable: true,
      });
    }
    seen.delete(value);
    return normalized;
  }
  throw new TypeError(
    "Canonical AMO sufficient state contains an unsupported value.",
  );
}

function canonicalPayloadCommitment(value, model) {
  const canonical = canonicalStateJsonValue(value, new Set());
  const payload = JSON.stringify({
    model,
    value: canonical,
  });
  return {
    model,
    payloadBytes: Buffer.byteLength(payload),
    sha256: sha256Text(payload),
  };
}

export function workAmoV5CanonicalPayloadCommitment(value) {
  return canonicalPayloadCommitment(
    value,
    WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  );
}

export function workAmoV5ConsensusEventKind(protocol, valid) {
  const normalizedProtocol = normalizedLowerText(protocol);
  return ["pwm1", "pwa1", "pwid1", "pwb1", "pwt1"].includes(
    normalizedProtocol,
  ) && typeof valid === "boolean"
    ? `${normalizedProtocol}-${valid ? "valid" : "invalid"}`
    : "";
}

export function selectWorkAmoV5DistinctRegistryPayment(
  outputs,
  {
    claimedVouts = [],
    protocolVout,
    registryAddress,
    requireBeforeProtocol = true,
    requiredSats,
  } = {},
) {
  const normalizedProtocolVout = canonicalSafeInteger(protocolVout);
  const normalizedRequiredSats = canonicalExactSafeInteger(requiredSats, {
    positive: true,
  });
  const normalizedRegistryAddress = String(registryAddress ?? "").trim();
  const claimed = new Set(
    canonicalCollectionValues(claimedVouts)
      .map((value) => canonicalSafeInteger(value))
      .filter((value) => value !== null),
  );
  if (
    normalizedProtocolVout === null ||
    !normalizedRegistryAddress ||
    normalizedRequiredSats === null
  ) {
    return null;
  }
  for (const output of Array.isArray(outputs) ? outputs : []) {
    const vout = canonicalSafeInteger(output?.vout);
    const amountSats = canonicalExactSafeInteger(output?.amountSats, {
      positive: true,
    });
    if (
      vout !== null &&
      (!requireBeforeProtocol || vout < normalizedProtocolVout) &&
      !claimed.has(vout) &&
      String(output?.address ?? "").trim() ===
        normalizedRegistryAddress &&
      amountSats !== null &&
      amountSats >= normalizedRequiredSats
    ) {
      return {
        registryAddress: normalizedRegistryAddress,
        registryPaymentSats: amountSats,
        registryPaymentVout: vout,
        requiredRegistryPaymentSats: normalizedRequiredSats,
      };
    }
  }
  return null;
}

export function selectWorkAmoV5EconomicOutputs(
  outputs,
  {
    address = "",
    candidateVouts = null,
    claimAll = false,
    claimedVouts = [],
    protocolVout,
    requireBeforeProtocol = true,
    requiredSats = null,
    role,
  } = {},
) {
  const normalizedProtocolVout = canonicalSafeInteger(protocolVout);
  const normalizedRequiredSats =
    requiredSats === null && claimAll
      ? null
      : canonicalExactSafeInteger(requiredSats, { positive: true });
  const normalizedAddress = String(address ?? "").trim();
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const claimed = new Set(
    canonicalCollectionValues(claimedVouts)
      .map((value) => canonicalSafeInteger(value))
      .filter((value) => value !== null),
  );
  const candidateValues = canonicalCollectionValues(candidateVouts);
  const candidates =
    candidateVouts !== null && candidateValues.length >= 0
      ? new Set(
          candidateValues
            .map((value) => canonicalSafeInteger(value))
            .filter((value) => value !== null),
        )
      : null;
  if (
    normalizedProtocolVout === null ||
    !normalizedRole ||
    (!claimAll && normalizedRequiredSats === null)
  ) {
    return null;
  }
  const eligible = (Array.isArray(outputs) ? outputs : [])
    .flatMap((output) => {
      const vout = canonicalSafeInteger(output?.vout);
      const outputSats = canonicalExactSafeInteger(
        output?.outputSats ?? output?.amountSats,
        { positive: true },
      );
      const outputAddress = String(output?.address ?? "").trim();
      return vout !== null &&
        outputSats !== null &&
        outputAddress &&
        (!requireBeforeProtocol || vout < normalizedProtocolVout) &&
        !claimed.has(vout) &&
        (!normalizedAddress || outputAddress === normalizedAddress) &&
        (!candidates || candidates.has(vout))
        ? [{ address: outputAddress, outputSats, vout }]
        : [];
    })
    .sort((left, right) => left.vout - right.vout);
  if (claimAll) {
    if (candidates && eligible.length !== candidates.size) {
      return null;
    }
    return eligible.map((output) => ({
      address: output.address,
      attributedSats: output.outputSats,
      outputSats: output.outputSats,
      role: normalizedRole,
      vout: output.vout,
    }));
  }
  const selected = [];
  let remaining = normalizedRequiredSats;
  for (const output of eligible) {
    if (remaining <= 0) {
      break;
    }
    const attributedSats = Math.min(remaining, output.outputSats);
    selected.push({
      address: output.address,
      attributedSats,
      outputSats: output.outputSats,
      role: normalizedRole,
      vout: output.vout,
    });
    remaining -= attributedSats;
  }
  return remaining === 0 ? selected : null;
}

/**
 * Assigns each economic output to at most one role without an
 * implementation-dependent search bound. Constrained and claim-all roles
 * precede unrestricted roles; otherwise larger requirements precede smaller
 * ones. A role takes the smallest single sufficient output, or the
 * largest-first deterministic prefix needed to cover it. This is the
 * canonical polynomial allocation rule, not an existential subset search.
 */
export function assignWorkAmoV5EconomicOutputs(
  outputs,
  requirements,
  {
    claimedVouts = [],
    protocolVout,
  } = {},
) {
  const normalizedProtocolVout = canonicalSafeInteger(protocolVout);
  if (
    normalizedProtocolVout === null ||
    !Array.isArray(requirements)
  ) {
    return null;
  }
  const normalizedRequirements = requirements.map(
    (requirement, index) => {
      const claimAll = requirement?.claimAll === true;
      const requiredSats = claimAll
        ? null
        : canonicalExactSafeInteger(requirement?.requiredSats, {
            positive: true,
          });
      const candidateVouts = [
        ...new Set(
          (Array.isArray(requirement?.candidateVouts)
            ? requirement.candidateVouts
            : [])
            .map((value) => canonicalSafeInteger(value))
            .filter((value) => value !== null),
        ),
      ].sort((left, right) => left - right);
      const role = normalizedLowerText(requirement?.role);
      return role && (claimAll || requiredSats !== null)
        ? {
            address: String(requirement?.address ?? "").trim(),
            attributeFullSelected:
              requirement?.attributeFullSelected === true,
            candidateVouts,
            claimAll,
            index,
            requireBeforeProtocol:
              requirement?.requireBeforeProtocol !== false,
            requiredSats,
            role,
          }
        : null;
    },
  );
  if (normalizedRequirements.some((requirement) => !requirement)) {
    return null;
  }
  const orderedRequirements = normalizedRequirements.slice().sort(
    (left, right) =>
      Number(right.claimAll) - Number(left.claimAll) ||
      Number(right.candidateVouts.length > 0) -
        Number(left.candidateVouts.length > 0) ||
      Number(right.requiredSats ?? 0) -
        Number(left.requiredSats ?? 0) ||
      left.index - right.index,
  );
  const initiallyClaimed = new Set(
    canonicalCollectionValues(claimedVouts)
      .map((value) => canonicalSafeInteger(value))
      .filter((value) => value !== null),
  );
  const rawOutputs = (Array.isArray(outputs) ? outputs : [])
    .flatMap((output) => {
      const vout = canonicalSafeInteger(output?.vout);
      const outputSats = canonicalExactSafeInteger(
        output?.outputSats ?? output?.amountSats,
        { positive: true },
      );
      const address = String(output?.address ?? "").trim();
      return vout !== null && outputSats !== null && address
        ? [{ address, outputSats, vout }]
        : [];
    })
    .sort((left, right) => left.vout - right.vout);
  if (new Set(rawOutputs.map((output) => output.vout)).size !== rawOutputs.length) {
    return null;
  }
  const assignments = new Array(normalizedRequirements.length);
  const claimed = new Set(initiallyClaimed);
  for (const requirement of orderedRequirements) {
    if (requirement.claimAll) {
      const selected = selectWorkAmoV5EconomicOutputs(rawOutputs, {
        address: requirement.address,
        candidateVouts: requirement.candidateVouts,
        claimAll: true,
        claimedVouts: claimed,
        protocolVout: normalizedProtocolVout,
        requireBeforeProtocol: requirement.requireBeforeProtocol,
        role: requirement.role,
      });
      if (!selected || selected.length === 0) {
        return null;
      }
      assignments[requirement.index] = selected;
      for (const output of selected) {
        claimed.add(output.vout);
      }
      continue;
    }
    const candidateSet =
      requirement.candidateVouts.length > 0
        ? new Set(requirement.candidateVouts)
        : null;
    const eligible = rawOutputs
      .filter(
        (output) =>
          !claimed.has(output.vout) &&
          (!requirement.requireBeforeProtocol ||
            output.vout < normalizedProtocolVout) &&
          (!requirement.address ||
            output.address === requirement.address) &&
          (!candidateSet || candidateSet.has(output.vout)),
      )
      .sort(
        (left, right) =>
          left.outputSats - right.outputSats ||
          left.vout - right.vout,
      );
    const sufficient = eligible.find(
      (output) => output.outputSats >= requirement.requiredSats,
    );
    const selected = [];
    if (sufficient) {
      selected.push(sufficient);
    } else {
      let total = 0;
      for (const output of eligible
        .slice()
        .sort(
          (left, right) =>
            right.outputSats - left.outputSats ||
            left.vout - right.vout,
        )) {
        selected.push(output);
        total += output.outputSats;
        if (total >= requirement.requiredSats) {
          break;
        }
      }
      if (total < requirement.requiredSats) {
        return null;
      }
    }
    assignments[requirement.index] = selected;
    for (const output of selected) {
      claimed.add(output.vout);
    }
  }
  const economicOutputs = [];
  for (const requirement of normalizedRequirements) {
    let remaining = requirement.requiredSats ?? 0;
    for (const output of (assignments[requirement.index] ?? []).slice().sort(
      (left, right) => left.vout - right.vout,
    )) {
      const attributedSats =
        requirement.claimAll || requirement.attributeFullSelected
          ? output.outputSats
          : Math.min(remaining, output.outputSats);
      economicOutputs.push({
        address: output.address,
        attributedSats,
        outputSats: output.outputSats,
        requirementIndex: requirement.index,
        role: requirement.role,
        vout: output.vout,
      });
      remaining -= attributedSats;
    }
  }
  economicOutputs.sort((left, right) => left.vout - right.vout);
  return {
    claimedVouts: [
      ...new Set([
        ...initiallyClaimed,
        ...economicOutputs.map((output) => output.vout),
      ]),
    ].sort((left, right) => left - right),
    economicOutputs,
  };
}

export function workAmoV5EventSetCommitment(events) {
  const normalized = [];
  const positions = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    const position = normalizeWorkAmoCanonicalPosition(
      event?.position ?? event,
    );
    const txid = normalizedTxid(event?.txid);
    const protocol = normalizedLowerText(event?.protocol);
    const reasonCode = event?.valid === true ? "" : "invalid";
    const kind = workAmoV5ConsensusEventKind(
      protocol,
      event?.valid,
    );
    const transactionMinerFeeSats = canonicalUnsignedIntegerText(
      event?.transactionMinerFeeSats ?? event?.feeSats,
    );
    const payloadCommitment = event?.payloadCommitment
      ? normalizedCommitment(event.payloadCommitment)
      : workAmoV5CanonicalPayloadCommitment(event?.payload ?? null);
    const outcomeCommitment = event?.outcomeCommitment
      ? normalizedCommitment(event.outcomeCommitment)
      : workAmoV5CanonicalPayloadCommitment(
          {
            reasonCode,
            valid: event?.valid === true,
          },
        );
    const stateDeltaCommitment = event?.stateDeltaCommitment
      ? normalizedCommitment(event.stateDeltaCommitment)
      : workAmoV5CanonicalPayloadCommitment(
          event?.stateDelta ?? {
            baseContributions: [],
            creditFixedQ8: "0",
            creditFixedSats: "0",
          },
        );
    const positionKey = position
      ? [
          position.blockHeight,
          position.blockTransactionIndex,
          position.protocolVout,
          position.recordOrdinal,
        ].join(":")
      : "";
    if (
      !position ||
      !txid ||
      !["pwm1", "pwa1", "pwid1", "pwb1", "pwt1"].includes(protocol) ||
      !kind ||
      typeof event?.valid !== "boolean" ||
      !transactionMinerFeeSats ||
      !payloadCommitment ||
      !outcomeCommitment ||
      !stateDeltaCommitment ||
      positions.has(positionKey)
    ) {
      throw new TypeError("work-amo-v5-event-set-invalid");
    }
    positions.add(positionKey);
    normalized.push({
      kind,
      outcomeCommitment,
      payloadCommitment,
      position,
      protocol,
      reasonCode,
      stateDeltaCommitment,
      transactionMinerFeeSats,
      txid,
      valid: event.valid,
    });
  }
  normalized.sort((left, right) =>
    compareWorkAmoCanonicalPositions(left.position, right.position),
  );
  const commitment = canonicalPayloadCommitment(
    normalized,
    WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
  );
  return {
    ...commitment,
    eventCount: normalized.length,
  };
}

export function workAmoV5CanonicalTokenStatePreimage(
  tokenState,
  { canonicalizeAdditionalListing = null } = {},
) {
  if (
    canonicalizeAdditionalListing !== null &&
    typeof canonicalizeAdditionalListing !== "function"
  ) {
    throw new TypeError(
      "work-amo-v5-token-state-listing-canonicalizer-invalid",
    );
  }
  const confirmedSupplyAtoms = canonicalUnsignedIntegerText(
    tokenState?.confirmedSupplyAtoms,
  );
  if (
    !confirmedSupplyAtoms ||
    BigInt(confirmedSupplyAtoms) >
      WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK
  ) {
    throw new TypeError("work-amo-v5-token-state-supply-invalid");
  }
  const holders = [];
  const holderAddresses = new Set();
  for (const holder of Array.isArray(tokenState?.holders)
    ? tokenState.holders
    : []) {
    const address = String(holder?.address ?? "").trim();
    const balanceAtoms = canonicalUnsignedIntegerText(
      holder?.balanceAtoms,
      { positive: true },
    );
    if (
      !address ||
      address.length > 128 ||
      !balanceAtoms ||
      BigInt(balanceAtoms) >
        WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK ||
      holderAddresses.has(address)
    ) {
      throw new TypeError("work-amo-v5-token-state-holder-invalid");
    }
    holderAddresses.add(address);
    holders.push({ address, balanceAtoms });
  }
  holders.sort((left, right) =>
    compareWorkAmoUtf8(left.address, right.address),
  );
  const listings = [];
  const listingIds = new Set();
  for (const listing of Array.isArray(tokenState?.listings)
    ? tokenState.listings
    : []) {
    const listingId = normalizedTxid(listing?.listingId ?? listing?.txid);
    const sellerAddress = String(listing?.sellerAddress ?? "").trim();
    const amountAtoms = canonicalUnsignedIntegerText(
      listing?.amountAtoms,
      { positive: true },
    );
    const priceSats = canonicalUnsignedIntegerText(
      listing?.priceSats,
      { positive: true },
    );
    const authorization =
      listing?.saleAuthorization &&
      typeof listing.saleAuthorization === "object" &&
      !Array.isArray(listing.saleAuthorization)
        ? listing.saleAuthorization
        : null;
    const version = String(authorization?.version ?? "").trim();
    const listingAuthorizationPresent =
      listing?.listingAuthorization !== undefined &&
      listing?.listingAuthorization !== null;
    const listingAuthorization =
      listingAuthorizationPresent &&
      typeof listing.listingAuthorization === "object" &&
      !Array.isArray(listing.listingAuthorization)
        ? listing.listingAuthorization
        : null;
    const listingAuthorizationVersion =
      listingAuthorization
        ? String(listingAuthorization.version ?? "").trim()
        : "";
    const frozenTerms =
      listing?.frozenTerms &&
      typeof listing.frozenTerms === "object" &&
      !Array.isArray(listing.frozenTerms)
        ? listing.frozenTerms
        : null;
    const v5Terms =
      version === WORK_AMO_V5_AUTH_VERSION
        ? validateWorkAmoV5FrozenTerms(frozenTerms, {
            authorization,
          })
        : null;
    const v5Authorization =
      version === WORK_AMO_V5_AUTH_VERSION
        ? validateWorkAmoV5StaticAuthorization(authorization)
        : null;
    const v4Witness =
      version === WORK_AMO_V4_AUTH_VERSION
        ? workAmoV5CanonicalHistoricalV4ListingWitness(
            authorization,
            frozenTerms,
          )
        : null;
    const additionalWitness =
      canonicalizeAdditionalListing &&
      ![WORK_AMO_V4_AUTH_VERSION, WORK_AMO_V5_AUTH_VERSION].includes(
        version,
      )
        ? canonicalizeAdditionalListing({
            authorization,
            frozenTerms,
            listingId,
            sellerAddress,
          })
        : null;
    const additionalAuthorization =
      additionalWitness?.saleAuthorization &&
      typeof additionalWitness.saleAuthorization === "object" &&
      !Array.isArray(additionalWitness.saleAuthorization)
        ? additionalWitness.saleAuthorization
        : null;
    const additionalFrozenTerms =
      additionalWitness?.frozenTerms &&
      typeof additionalWitness.frozenTerms === "object" &&
      !Array.isArray(additionalWitness.frozenTerms)
        ? additionalWitness.frozenTerms
        : null;
    const additionalAmountAtoms = canonicalUnsignedIntegerText(
      additionalWitness?.amountAtoms,
      { positive: true },
    );
    const additionalPriceSats = canonicalUnsignedIntegerText(
      additionalWitness?.priceSats,
      { positive: true },
    );
    const additionalVersion = String(
      additionalAuthorization?.version ?? "",
    ).trim();
    if (
      !listingId ||
      !sellerAddress ||
      sellerAddress.length > 128 ||
      !amountAtoms ||
      BigInt(amountAtoms) >
        WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK ||
      !priceSats ||
      (
        ![WORK_AMO_V4_AUTH_VERSION, WORK_AMO_V5_AUTH_VERSION].includes(
          version,
        ) &&
        (
          !additionalAuthorization ||
          !additionalFrozenTerms ||
          additionalVersion !== version ||
          additionalFrozenTerms.version !== version ||
          additionalAmountAtoms !== amountAtoms ||
          additionalPriceSats !== priceSats
        )
      ) ||
      (
        listingAuthorizationPresent &&
        (
          !listingAuthorizationVersion ||
          listingAuthorizationVersion !== version ||
          canonicalPayloadCommitment(listingAuthorization).sha256 !==
            canonicalPayloadCommitment(authorization).sha256
        )
      ) ||
      (version === WORK_AMO_V5_AUTH_VERSION &&
        (v5Authorization?.valid !== true ||
          v5Terms?.valid !== true ||
          v5Terms.frozenTerms.unitAmountAtoms !== amountAtoms ||
          v5Terms.frozenTerms.unitPriceSats !== priceSats)) ||
      (version === WORK_AMO_V4_AUTH_VERSION &&
        (!v4Witness ||
          v4Witness.frozenTerms.unitAmountAtoms !== amountAtoms ||
          v4Witness.frozenTerms.unitPriceSats !== priceSats)) ||
      listingIds.has(listingId)
    ) {
      throw new TypeError("work-amo-v5-token-state-listing-invalid");
    }
    listingIds.add(listingId);
    listings.push({
      amountAtoms,
      frozenTerms:
        version === WORK_AMO_V5_AUTH_VERSION
          ? v5Terms.frozenTerms
          : version === WORK_AMO_V4_AUTH_VERSION
            ? v4Witness.frozenTerms
            : additionalFrozenTerms,
      listingId,
      priceSats,
      saleAuthorization:
        version === WORK_AMO_V5_AUTH_VERSION
          ? v5Authorization.authorization
          : version === WORK_AMO_V4_AUTH_VERSION
            ? v4Witness.saleAuthorization
            : additionalAuthorization,
      sellerAddress,
    });
  }
  listings.sort((left, right) =>
    compareWorkAmoUtf8(left.listingId, right.listingId),
  );
  const holderTotal = holders.reduce(
    (total, holder) => total + BigInt(holder.balanceAtoms),
    0n,
  );
  const reservedAtoms = listings.reduce(
    (total, listing) => total + BigInt(listing.amountAtoms),
    0n,
  );
  const holderBalanceByAddress = new Map(
    holders.map((holder) => [holder.address, BigInt(holder.balanceAtoms)]),
  );
  const reservedBySeller = new Map();
  for (const listing of listings) {
    reservedBySeller.set(
      listing.sellerAddress,
      (reservedBySeller.get(listing.sellerAddress) ?? 0n) +
        BigInt(listing.amountAtoms),
    );
  }
  if (
    holderTotal !== BigInt(confirmedSupplyAtoms) ||
    reservedAtoms > holderTotal ||
    [...reservedBySeller].some(
      ([sellerAddress, reserved]) =>
        !holderBalanceByAddress.has(sellerAddress) ||
        reserved > holderBalanceByAddress.get(sellerAddress),
    )
  ) {
    throw new TypeError("work-amo-v5-token-state-balance-parity-invalid");
  }
  return {
    confirmedSupplyAtoms,
    definition: {
      decimals: 8,
      maxSupplyAtoms: (
        WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK
      ).toString(),
      registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
    },
    holders,
    listings,
    model: WORK_AMO_V5_TOKEN_STATE_PREIMAGE_MODEL,
    reservedAtoms: reservedAtoms.toString(),
  };
}

export function workAmoV5CanonicalTokenStateCommitment(
  tokenState,
  options,
) {
  return workAmoV5CanonicalPayloadCommitment(
    workAmoV5CanonicalTokenStatePreimage(tokenState, options),
  );
}

function normalizedCommitment(value) {
  const model = String(value?.model ?? "").trim();
  const sha256 = normalizedLowerText(value?.sha256);
  const payloadBytes = canonicalSafeInteger(value?.payloadBytes, {
    positive: true,
  });
  return model === WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL &&
    TXID_PATTERN.test(sha256) &&
    payloadBytes !== null
    ? { model, payloadBytes, sha256 }
    : null;
}

export function validateWorkAmoV5SufficientState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.model !== WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL ||
    value.network !== "livenet"
  ) {
    return invalid("work-amo-v5-sufficient-state-model-invalid");
  }
  const throughBlockHeight = canonicalSafeInteger(value.throughBlockHeight, {
    positive: true,
  });
  const throughBlockHash = normalizedTxid(value.throughBlockHash);
  const networkValueQ8 = canonicalUnsignedIntegerText(value.networkValueQ8, {
    positive: true,
  });
  const creditFixedQ8 = canonicalUnsignedIntegerText(value.creditFixedQ8);
  const creditMovementFrozenValueQ8 = canonicalUnsignedIntegerText(
    value.creditMovementFrozenValueQ8,
  );
  const tokenStateCommitment = normalizedCommitment(
    value.tokenStateCommitment,
  );
  const genericTokenStateCommitment = normalizedCommitment(
    value.genericTokenStateCommitment,
  );
  const idStateCommitment = normalizedCommitment(
    value.idStateCommitment,
  );
  if (
    throughBlockHeight === null ||
    !throughBlockHash ||
    !networkValueQ8 ||
    !creditFixedQ8 ||
    !creditMovementFrozenValueQ8 ||
    !genericTokenStateCommitment ||
    !idStateCommitment ||
    !tokenStateCommitment
  ) {
    return invalid("work-amo-v5-sufficient-state-binding-invalid");
  }
  const baseSource =
    value.baseState &&
    typeof value.baseState === "object" &&
    !Array.isArray(value.baseState)
      ? value.baseState
      : null;
  if (
    !baseSource ||
    Object.keys(baseSource).length !== WORK_AMO_V5_BASE_STATE_FIELDS.length
  ) {
    return invalid("work-amo-v5-sufficient-state-base-invalid");
  }
  const baseState = {};
  for (const field of WORK_AMO_V5_BASE_STATE_FIELDS) {
    const text = canonicalUnsignedIntegerText(baseSource[field]);
    if (!text) {
      return invalid("work-amo-v5-sufficient-state-base-invalid");
    }
    baseState[field] = text;
  }
  const movements = [];
  const movementIdentities = new Set();
  for (const movement of Array.isArray(value.movements)
    ? value.movements
    : []) {
    const identity = String(movement?.identity ?? "").trim();
    const amountAtoms = canonicalUnsignedIntegerText(
      movement?.amountAtoms,
      { positive: true },
    );
    const amountSubatoms = canonicalUnsignedIntegerText(
      movement?.amountSubatoms,
      { positive: true },
    );
    const subatomMovement =
      movement?.amountStorageModel ===
        WORK_SUBATOM_PROJECTION_MODEL &&
      Boolean(amountSubatoms) &&
      !amountAtoms;
    const atomMovement =
      !movement?.amountStorageModel &&
      Boolean(amountAtoms) &&
      !amountSubatoms;
    if (
      !identity ||
      identity.length > 256 ||
      (!atomMovement && !subatomMovement) ||
      (
        atomMovement &&
        BigInt(amountAtoms) >
          WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK
      ) ||
      (
        subatomMovement &&
        BigInt(amountSubatoms) >
          WORK_AMO_V5_MAX_SUPPLY * WORK_SUBATOM_UNIT_SCALE
      ) ||
      movementIdentities.has(identity)
    ) {
      return invalid("work-amo-v5-sufficient-state-movement-invalid");
    }
    movementIdentities.add(identity);
    movements.push(
      subatomMovement
        ? {
            amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
            amountSubatoms,
            identity,
          }
        : { amountAtoms, identity },
    );
  }
  const quoteHead =
    value.quoteHead == null
      ? null
      : normalizeCanonicalQuoteProjection(value.quoteHead);
  if (value.quoteHead != null && !quoteHead) {
    return invalid("work-amo-v5-sufficient-state-quote-invalid");
  }
  const state = {
    baseState,
    creditFixedQ8,
    creditMovementFrozenValueQ8,
    genericTokenStateCommitment,
    idStateCommitment,
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
    movements,
    network: "livenet",
    networkValueQ8,
    quoteHead,
    throughBlockHash,
    throughBlockHeight,
    tokenStateCommitment,
  };
  const evaluated = evaluateWorkAmoV5SufficientState(state);
  return evaluated && evaluated.networkValueQ8 === networkValueQ8
    ? { evaluated, state, valid: true }
    : invalid("work-amo-v5-sufficient-state-network-value-mismatch");
}

function evaluateWorkAmoV5SufficientState(state) {
  try {
    const base = Object.fromEntries(
      WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [
        field,
        BigInt(state.baseState[field]),
      ]),
    );
    const marketplaceFlowSats =
      base.idMarketplaceVolumeSats +
      base.tokenSaleVolumeSats +
      base.idMarketplaceFeeSats +
      base.tokenMarketplaceFeeSats;
    const baseNetworkValueQ8 =
      (base.powids *
        base.powids *
        WORK_AMO_V5_ID_DENSITY_NUMERATOR *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE) /
        WORK_AMO_V5_ID_DENSITY_DENOMINATOR +
      (
        base.mailFlowSats +
        base.inceptionBondFlowSats +
        base.infinityBondFlowSats +
        base.driveFlowSats +
        marketplaceFlowSats +
        base.browserFlowSats +
        base.tokenCreationFlowSats +
        base.tokenMintFlowSats +
        base.tokenTransferFlowSats +
        base.computerEventFlowSats
      ) *
        WORK_AMO_V5_GROWTH_VALUE_MULTIPLE *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
    const creditFixedQ8 = BigInt(state.creditFixedQ8);
    const creditMovementFrozenValueQ8 = BigInt(
      state.creditMovementFrozenValueQ8,
    );
    const frozenNetworkValueQ8 =
      baseNetworkValueQ8 +
      creditFixedQ8 +
      creditMovementFrozenValueQ8;
    const creditMovementLiveValueQ8 = state.movements.reduce(
      (total, movement) =>
        total +
        (
          BigInt(
            movement.amountStorageModel ===
              WORK_SUBATOM_PROJECTION_MODEL
              ? movement.amountSubatoms
              : movement.amountAtoms,
          ) * frozenNetworkValueQ8
        ) /
          (
            WORK_AMO_V5_MAX_SUPPLY *
            (
              movement.amountStorageModel ===
                WORK_SUBATOM_PROJECTION_MODEL
                ? WORK_SUBATOM_UNIT_SCALE
                : WORK_AMO_V5_ATOMS_PER_WORK
            )
          ),
      0n,
    );
    const networkValueQ8 =
      baseNetworkValueQ8 + creditFixedQ8 + creditMovementLiveValueQ8;
    return {
      baseNetworkValueQ8: baseNetworkValueQ8.toString(),
      creditMovementLiveValueQ8:
        creditMovementLiveValueQ8.toString(),
      frozenNetworkValueQ8: frozenNetworkValueQ8.toString(),
      networkValueQ8: networkValueQ8.toString(),
    };
  } catch {
    return null;
  }
}

export function workAmoV5NetworkValueQ8FromSufficientState(value) {
  const validation = validateWorkAmoV5SufficientState(value);
  return validation.valid ? validation.evaluated : null;
}

export function workAmoV5CanonicalStateCommitment(state) {
  const validation = validateWorkAmoV5SufficientState(state);
  if (!validation.valid) {
    throw new TypeError(validation.reasonCode);
  }
  return canonicalPayloadCommitment(
    validation.state,
    WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  );
}

export function workAmoV5CanonicalStatesMatch(left, right) {
  try {
    return (
      workAmoV5CanonicalStateCommitment(left).sha256 ===
      workAmoV5CanonicalStateCommitment(right).sha256
    );
  } catch {
    return false;
  }
}

function normalizedSequencerRecord(entry, blockHeight, blockHash) {
  const position = normalizeWorkAmoCanonicalPosition(entry?.position ?? entry);
  const txid = normalizedTxid(entry?.txid);
  const transactionProtocolRecordCount = canonicalSafeInteger(
    entry?.transactionProtocolRecordCount,
    { positive: true },
  );
  const transactionMinerFeeSatsText = canonicalUnsignedIntegerText(
    entry?.transactionMinerFeeSats,
  );
  if (
    !position ||
    position.blockHeight !== blockHeight ||
    position.blockHash !== blockHash ||
    !txid ||
    transactionProtocolRecordCount === null ||
    !transactionMinerFeeSatsText
  ) {
    sequencerFailure("work-amo-v5-sequencer-position-incomplete", {
      txid: String(entry?.txid ?? "").trim().toLowerCase(),
    });
  }
  return {
    ...entry,
    position,
    transactionMinerFeeSats: transactionMinerFeeSatsText,
    transactionProtocolRecordCount,
    txid,
  };
}

/**
 * Replays one confirmed block as a single all-or-nothing canonical state
 * transition. Records are ordered by the full protocol position. A record is
 * computed against N-before and, only when valid, may return its next state.
 * The transaction fee is a distinct pseudo-transition after the transaction's
 * final protocol record and contributes only when that transaction contains at
 * least one valid canonical protocol event.
 */
export function replayWorkAmoV5CanonicalBlock({
  applyTransactionFee,
  blockHash,
  blockHeight,
  evaluateRecord,
  openingState,
  records,
  valueFromState,
} = {}) {
  const normalizedBlockHeight = canonicalSafeInteger(blockHeight, {
    positive: true,
  });
  const normalizedBlockHash = normalizedTxid(blockHash);
  if (
    normalizedBlockHeight === null ||
    normalizedBlockHeight < WORK_AMO_V5_ACTIVATION_HEIGHT ||
    !normalizedBlockHash ||
    typeof evaluateRecord !== "function" ||
    typeof applyTransactionFee !== "function" ||
    typeof valueFromState !== "function" ||
    !Array.isArray(records)
  ) {
    sequencerFailure("work-amo-v5-sequencer-input-invalid");
  }

  const ordered = records
    .map((entry) =>
      normalizedSequencerRecord(
        entry,
        normalizedBlockHeight,
        normalizedBlockHash,
      ),
    )
    .sort((left, right) =>
      compareWorkAmoCanonicalPositions(left.position, right.position),
    );
  const positionKeys = new Set();
  const transactions = new Map();
  for (const entry of ordered) {
    const positionKey = [
      entry.position.blockTransactionIndex,
      entry.position.protocolVout,
      entry.position.recordOrdinal,
    ].join(":");
    if (positionKeys.has(positionKey)) {
      sequencerFailure("work-amo-v5-sequencer-position-duplicate", {
        positionKey,
      });
    }
    positionKeys.add(positionKey);
    const current = transactions.get(entry.txid);
    if (
      current &&
      (current.blockTransactionIndex !==
        entry.position.blockTransactionIndex ||
        current.transactionMinerFeeSats !== entry.transactionMinerFeeSats ||
        current.transactionProtocolRecordCount !==
          entry.transactionProtocolRecordCount)
    ) {
      sequencerFailure("work-amo-v5-sequencer-transaction-binding-invalid", {
        txid: entry.txid,
      });
    }
    const transaction =
      current ?? {
        blockTransactionIndex: entry.position.blockTransactionIndex,
        entries: [],
        transactionMinerFeeSats: entry.transactionMinerFeeSats,
        transactionProtocolRecordCount:
          entry.transactionProtocolRecordCount,
        txid: entry.txid,
      };
    transaction.entries.push(entry);
    transactions.set(entry.txid, transaction);
  }
  const blockIndexes = new Map();
  for (const transaction of transactions.values()) {
    const existingTxid = blockIndexes.get(transaction.blockTransactionIndex);
    if (existingTxid && existingTxid !== transaction.txid) {
      sequencerFailure("work-amo-v5-sequencer-transaction-position-duplicate", {
        blockTransactionIndex: transaction.blockTransactionIndex,
      });
    }
    blockIndexes.set(transaction.blockTransactionIndex, transaction.txid);
    if (
      transaction.entries.length !==
      transaction.transactionProtocolRecordCount
    ) {
      sequencerFailure("work-amo-v5-sequencer-record-set-incomplete", {
        actual: transaction.entries.length,
        expected: transaction.transactionProtocolRecordCount,
        txid: transaction.txid,
      });
    }
    const entriesByVout = new Map();
    for (const entry of transaction.entries) {
      const list = entriesByVout.get(entry.position.protocolVout) ?? [];
      list.push(entry.position.recordOrdinal);
      entriesByVout.set(entry.position.protocolVout, list);
    }
    for (const [protocolVout, ordinals] of entriesByVout) {
      ordinals.sort((left, right) => left - right);
      if (ordinals.some((ordinal, index) => ordinal !== index)) {
        sequencerFailure("work-amo-v5-sequencer-record-set-incomplete", {
          protocolVout,
          txid: transaction.txid,
        });
      }
    }
  }

  let state = sequencerClone(openingState);
  const openingNetworkValueQ8 = sequencerNetworkValueQ8(
    state,
    valueFromState,
  );
  const traces = [];
  let cursor = 0;
  while (cursor < ordered.length) {
    const first = ordered[cursor];
    const transaction = transactions.get(first.txid);
    let transactionHasValidCanonicalEvent = false;
    for (const entry of transaction.entries) {
      if (ordered[cursor]?.txid !== entry.txid) {
        sequencerFailure("work-amo-v5-sequencer-transaction-not-contiguous", {
          txid: entry.txid,
        });
      }
      const networkValueBeforeQ8 = sequencerNetworkValueQ8(
        state,
        valueFromState,
      );
      let result;
      try {
        result = evaluateRecord({
          entry,
          networkValueBeforeQ8,
          state: sequencerClone(state),
        });
      } catch (error) {
        sequencerFailure("work-amo-v5-sequencer-record-evaluation-failed", {
          cause: String(error?.message ?? error),
          txid: entry.txid,
        });
      }
      if (!result || typeof result !== "object") {
        sequencerFailure("work-amo-v5-sequencer-record-result-invalid", {
          txid: entry.txid,
        });
      }
      const valid = result.valid === true;
      if (valid) {
        transactionHasValidCanonicalEvent = true;
        if (!Object.hasOwn(result, "state")) {
          sequencerFailure("work-amo-v5-sequencer-record-state-missing", {
            txid: entry.txid,
          });
        }
        state = sequencerClone(result.state);
      }
      const networkValueAfterQ8 = sequencerNetworkValueQ8(
        state,
        valueFromState,
      );
      if (networkValueAfterQ8 < networkValueBeforeQ8) {
        sequencerFailure("work-amo-v5-sequencer-negative-bond", {
          txid: entry.txid,
        });
      }
      if (!valid && networkValueAfterQ8 !== networkValueBeforeQ8) {
        sequencerFailure("work-amo-v5-sequencer-invalid-record-mutated-state", {
          txid: entry.txid,
        });
      }
      traces.push({
        bondContributionQ8: (
          networkValueAfterQ8 - networkValueBeforeQ8
        ).toString(),
        kind: "protocol-record",
        networkValueAfterQ8: networkValueAfterQ8.toString(),
        networkValueBeforeQ8: networkValueBeforeQ8.toString(),
        output: result.output ?? null,
        position: entry.position,
        reasonCode: valid
          ? ""
          : String(result.reasonCode ?? "work-amo-v5-record-invalid"),
        txid: entry.txid,
        valid,
      });
      cursor += 1;
    }

    const networkValueBeforeQ8 = sequencerNetworkValueQ8(
      state,
      valueFromState,
    );
    let feeResult;
    try {
      feeResult = applyTransactionFee({
        networkValueBeforeQ8,
        state: sequencerClone(state),
        transaction: {
          blockTransactionIndex: transaction.blockTransactionIndex,
          hasValidCanonicalEvent:
            transactionHasValidCanonicalEvent,
          transactionMinerFeeSats: transaction.transactionMinerFeeSats,
          transactionProtocolRecordCount:
            transaction.transactionProtocolRecordCount,
          txid: transaction.txid,
        },
      });
    } catch (error) {
      sequencerFailure("work-amo-v5-sequencer-fee-evaluation-failed", {
        cause: String(error?.message ?? error),
        txid: transaction.txid,
      });
    }
    if (
      !feeResult ||
      typeof feeResult !== "object" ||
      !Object.hasOwn(feeResult, "state")
    ) {
      sequencerFailure("work-amo-v5-sequencer-fee-state-missing", {
        txid: transaction.txid,
      });
    }
    state = sequencerClone(feeResult.state);
    const networkValueAfterQ8 = sequencerNetworkValueQ8(
      state,
      valueFromState,
    );
    if (networkValueAfterQ8 < networkValueBeforeQ8) {
      sequencerFailure("work-amo-v5-sequencer-negative-bond", {
        txid: transaction.txid,
      });
    }
    traces.push({
      bondContributionQ8: (
        networkValueAfterQ8 - networkValueBeforeQ8
      ).toString(),
      kind: "transaction-fee",
      networkValueAfterQ8: networkValueAfterQ8.toString(),
      networkValueBeforeQ8: networkValueBeforeQ8.toString(),
      output: feeResult.output ?? null,
      transactionMinerFeeSats: transaction.transactionMinerFeeSats,
      txid: transaction.txid,
      reasonCode: transactionHasValidCanonicalEvent
        ? ""
        : "work-amo-v5-invalid-only-transaction",
      valid: transactionHasValidCanonicalEvent,
    });
  }
  const closingNetworkValueQ8 = sequencerNetworkValueQ8(
    state,
    valueFromState,
  );
  return {
    blockAtomic: true,
    blockHash: normalizedBlockHash,
    blockHeight: normalizedBlockHeight,
    closingNetworkValueQ8: closingNetworkValueQ8.toString(),
    feeOnce: true,
    invalidZero: true,
    model: WORK_AMO_V5_BLOCK_SEQUENCER_MODEL,
    openingNetworkValueQ8: openingNetworkValueQ8.toString(),
    protocolRecordCount: ordered.length,
    state,
    traces,
    transactionCount: transactions.size,
  };
}

export function workAmoV5BroadcastDecision(
  actions,
  { metadata = null, network = "livenet" } = {},
) {
  const candidates = Array.isArray(actions) ? actions : [];
  if (String(network).trim().toLowerCase() !== "livenet" || candidates.length === 0) {
    return { allowed: true };
  }
  if (metadata?.protocolWritesEnabled !== true) {
    return {
      allowed: false,
      code: "WORK_AMO_V5_WRITES_PAUSED",
      reasonCode: metadata?.reasonCode ?? "work-amo-v5-writes-paused",
      statusCode: 503,
    };
  }
  if (
    candidates.some(
      (action) =>
        action?.canonicalParsed !== true ||
        action?.authVersion !== WORK_AMO_V5_AUTH_VERSION,
    )
  ) {
    return {
      allowed: false,
      code: "WORK_AMO_V5_REQUIRED",
      reasonCode: "work-amo-v5-version-required",
      statusCode: 400,
    };
  }
  for (const action of candidates) {
    const actionName = String(action?.action ?? "").trim().toLowerCase();
    if (!["list5", "seal5", "buy5"].includes(actionName)) {
      return {
        allowed: false,
        code: "WORK_AMO_V5_TRANSACTION_INVALID",
        reasonCode: "work-amo-v5-action-invalid",
        statusCode: 400,
      };
    }
    if (
      action?.paysWorkRegistry !== true ||
      normalizedLowerText(action?.tokenId) !== WORK_TOKEN_ID ||
      String(action?.ticker ?? "").trim().toUpperCase() !== "WORK" ||
      String(action?.registryAddress ?? "").trim() !==
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
      action?.tokenProtocolMessageCount !== 1 ||
      action?.signedShapeValid !== true
    ) {
      return {
        allowed: false,
        code: "WORK_AMO_V5_TRANSACTION_INVALID",
        reasonCode: "work-amo-v5-transaction-shape-invalid",
        statusCode: 400,
      };
    }
    if (
      actionName === "list5" &&
      metadata?.listingWritesEnabled !== true
    ) {
      return {
        allowed: false,
        code: "WORK_AMO_V5_WRITES_PAUSED",
        reasonCode:
          metadata?.reasonCode ?? "work-amo-v5-quote-not-ready",
        statusCode: 503,
      };
    }
    const referencedV4 =
      actionName !== "list5" &&
      (action?.listingAuthorization?.version ===
        WORK_AMO_V4_AUTH_VERSION ||
        action?.listingFrozenTerms?.authorizationVersion ===
          WORK_AMO_V4_AUTH_VERSION ||
        action?.listingFrozenTerms?.version ===
          WORK_AMO_V4_AUTH_VERSION);
    const validation = referencedV4
      ? validateWorkAmoV5ReferencedAuthorization(
          action?.saleAuthorization,
          {
            listingAuthorization: action?.listingAuthorization,
            listingFrozenTerms: action?.listingFrozenTerms,
          },
        )
      : validateWorkAmoV5StaticAuthorization(
          action?.saleAuthorization,
        );
    if (!validation.valid) {
      return {
        allowed: false,
        code: "WORK_AMO_V5_STATIC_AUTHORIZATION_INVALID",
        reasonCode: validation.reasonCode,
        statusCode: 400,
      };
    }
    if (actionName !== "list5" && !referencedV4) {
      const frozenValidation = validateWorkAmoV5FrozenTerms(
        action?.listingFrozenTerms,
        { authorization: action?.saleAuthorization },
      );
      if (!frozenValidation.valid) {
        return {
          allowed: false,
          code: "WORK_AMO_V5_FROZEN_TERMS_INVALID",
          reasonCode: frozenValidation.reasonCode,
          statusCode: 400,
        };
      }
    }
  }
  return { allowed: true };
}
