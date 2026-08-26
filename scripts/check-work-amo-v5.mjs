import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as bitcoin from "bitcoinjs-lib";
import {
  CanonicalConvergenceTimeoutError,
  MarketplaceRegressionHttpError,
  createCanonicalConvergenceBudget,
  isRetryableCanonicalReadError,
  isRetryableWorkAmoV5TipRaceStatus,
  marketplaceRegressionCanonicalReadKind,
  waitForCanonicalConvergence,
  waitForCanonicalConvergenceWithinBudget,
} from "./marketplace-canonical-convergence.mjs";
import {
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V4_ORACLE_MODEL,
  WORK_AMO_V4_UNIT_MODEL,
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_ALLOWED_FACE_USD_CENTS,
  WORK_AMO_V5_AMOUNT_MODEL,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_BOND_TRANSITION_MODEL,
  WORK_AMO_V5_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_BLOCK_HASH,
  WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
  WORK_AMO_V5_DECLARATION_HEIGHT,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_PAYLOAD_BYTES,
  WORK_AMO_V5_DECLARATION_PAYLOAD_SHA256,
  WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT,
  WORK_AMO_V5_DECLARATION_RECORD_ORDINAL,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_DECLARATION_REGISTRY_PAYMENT_VOUT,
  WORK_AMO_V5_DECLARATION_TXID,
  WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT,
  WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
  WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION,
  WORK_AMO_V5_ID_REGISTRY_ADDRESS,
  WORK_AMO_V5_ID_SALE_AUTH_VERSION,
  WORK_AMO_V5_INCB_TOKEN_ID,
  WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
  WORK_AMO_V5_MODELS,
  WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS,
  WORK_AMO_V5_PRE_UNIT_RELIC_ANCHOR_SCRIPT_PUBKEY,
  WORK_AMO_V5_PRE_UNIT_RELIC_AUTH_VERSION,
  WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HASH,
  WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT,
  WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX,
  WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_TIME,
  WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES,
  WORK_AMO_V5_PRE_UNIT_RELIC_DISABLED_REASON,
  WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  WORK_AMO_V5_PRE_UNIT_RELIC_MINER_FEE_SATS,
  WORK_AMO_V5_PRE_UNIT_RELIC_MINIMUM_PRICE_SATS,
  WORK_AMO_V5_PRE_UNIT_RELIC_MODEL,
  WORK_AMO_V5_PRE_UNIT_RELIC_NONCE,
  WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_BLOCK_HASH,
  WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_BLOCK_HEIGHT,
  WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_MODEL,
  WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_NETWORK_VALUE_Q8,
  WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS,
  WORK_AMO_V5_PRE_UNIT_RELIC_PROTOCOL_VOUT,
  WORK_AMO_V5_PRE_UNIT_RELIC_RECORD_ORDINAL,
  WORK_AMO_V5_PRE_UNIT_RELIC_REGISTRY_ADDRESS,
  WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS,
  WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_PUBLIC_KEY,
  WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT,
  WORK_AMO_V5_POWB_TOKEN_ID,
  WORK_AMO_V5_TOKEN_INDEX_ADDRESS,
  WORK_AMO_V5_STATE_ORDER_MODEL,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  WORK_AMO_V5_TOKEN_STATE_PREIMAGE_MODEL,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_UNIT_MODEL,
  WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
  WORK_AMO_V5_UNIT_WORK_ORACLE_MODEL,
  WORK_AMO_V5_V1_ACTIVATION_HEIGHT,
  WORK_AMO_V5_V1_DECLARATION_BLOCK_HASH,
  WORK_AMO_V5_V1_DECLARATION_BLOCK_INDEX,
  WORK_AMO_V5_V1_DECLARATION_HEIGHT,
  WORK_AMO_V5_V1_DECLARATION_TXID,
  applyWorkAmoV5CutoverToTokenState,
  assignWorkAmoV5EconomicOutputs,
  calculateWorkAmoV5UnitTerms,
  compareWorkAmoUtf8,
  compareWorkAmoCanonicalPositions,
  deriveWorkAmoV5FrozenTerms,
  normalizeWorkAmoCanonicalPosition,
  parseWorkAmoV5GenericSaleAuthorization,
  parseWorkAmoV5IdSaleAuthorization,
  parseWorkAmoV5PwmMessages,
  parseWorkAmoV5RawPwtRecord,
  parseWorkAmoV5RawPwidRecord,
  parseWorkAmoUsdQuoteRecord,
  replayWorkAmoV5CanonicalBlock,
  selectWorkAmoV5EconomicOutputs,
  selectWorkAmoV5DistinctRegistryPayment,
  selectCanonicalWorkAmoUsdQuoteChain,
  selectWorkAmoUsdQuoteBeforeListing,
  validateWorkAmoUsdQuoteEvidence,
  validateWorkAmoV5DeclarationEvidence,
  validateWorkAmoV5FrozenTerms,
  validateWorkAmoV5ReferencedAuthorization,
  validateWorkAmoV5SealOrBuyTerms,
  validateWorkAmoV5StaticAuthorization,
  workAmoCanonicalPositionPrecedes,
  workAmoCeilDiv,
  workAmoFloorDiv,
  workAmoV5ActivationFromEvidence,
  workAmoV5ActivationReached,
  workAmoV5BroadcastDecision,
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5CanonicalStateCommitment,
  workAmoV5CanonicalStatesMatch,
  workAmoV5CanonicalTokenStateCommitment,
  workAmoV5CanonicalTokenStatePreimage,
  workAmoV5ConsensusEventKind,
  workAmoV5EventSetCommitment,
  workAmoV5NetworkValueQ8FromSufficientState,
  validateWorkAmoV5SufficientState,
  workAmoV5FrozenTermsMatch,
  workAmoV5PreUnitRelicEvidenceIsExact,
  workAmoV5StatusFromEvidence,
} from "../server/work-amo-v5.mjs";
import {
  workAmoV5GenericTokenStatePreimageFromRows,
  workAmoV5PreUnitRelicEvidenceFromRows,
} from "../server/db/proof-index-reader.mjs";
import {
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState,
  replayWorkAmoV5RawBlock,
  WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
  WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
  WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "../server/work-amo-v5-raw.mjs";
import {
  CANONICAL_OP_RETURN_SCRIPT_MALFORMED,
  CANONICAL_PWM_ENVELOPE_NONCONTIGUOUS,
  canonicalRawProtocolRecordSetFromTransaction,
} from "../server/canonical-op-return.mjs";
import {
  workAmoV8CanonicalTokenStateCommitment,
} from "../server/work-amo-v8.mjs";
import {
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_TOKEN_ID,
} from "../server/work-units.mjs";

const hash = (byte) => byte.repeat(64);
const readerSource = readFileSync(
  new URL("../server/db/proof-index-reader.mjs", import.meta.url),
  "utf8",
);
const rawReplaySource = readFileSync(
  new URL("../server/work-amo-v5-raw.mjs", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  rawReplaySource,
  /listingRecordOrdinal\s*\?\?\s*0/u,
  "V5 raw listing references must never manufacture a missing ordinal as zero",
);
assert.match(
  rawReplaySource,
  /authorizationVersion === WORK_AMO_V4_AUTH_VERSION/u,
  "Only the explicit historical V4 compatibility path may supply ordinal zero",
);
for (const exactColumn of [
  "definition.max_supply::text AS max_supply",
  "definition.mint_amount::text AS mint_amount",
  "definition.mint_price_sats::text AS mint_price_sats",
  "balance.confirmed_balance::text AS confirmed_balance",
  "listing.amount::text AS amount",
  "listing.price_sats::text AS price_sats",
]) {
  assert.ok(
    readerSource.includes(exactColumn),
    `AMO V5 SQL preimage must preserve ${exactColumn}`,
  );
}

const postUnitInvalidListingId = hash("2");
const grandfatheredV4ListingId = hash("3");
const exactAmoActivationBlockTime = "2026-07-26T00:17:29.000Z";
const exactAmoActivation = {
  activationHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
  active: true,
  blockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
  blockHeight: WORK_AMO_V5_DECLARATION_HEIGHT,
  blockIndex: WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
  blockTime: exactAmoActivationBlockTime,
  canonical: true,
  confirmed: true,
  declarationTxid: WORK_AMO_V5_DECLARATION_TXID,
  evidenceComplete: true,
  txid: WORK_AMO_V5_DECLARATION_TXID,
};
const exactPreUnitAuthorization = {
  amountAtoms: WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS,
  anchorScriptPubKey: WORK_AMO_V5_PRE_UNIT_RELIC_ANCHOR_SCRIPT_PUBKEY,
  anchorSigHashType: 0x83,
  anchorType: "sale-ticket-v1",
  anchorValueSats: WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  anchorVout: WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT,
  buyerAddress: "",
  expiresAt: "",
  network: "livenet",
  nonce: WORK_AMO_V5_PRE_UNIT_RELIC_NONCE,
  minimumPriceSats: String(
    WORK_AMO_V5_PRE_UNIT_RELIC_MINIMUM_PRICE_SATS,
  ),
  oracleBlockHash: WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_BLOCK_HASH,
  oracleBlockHeight: WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_BLOCK_HEIGHT,
  oracleModel: WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_MODEL,
  oracleNetworkValueQ8:
    WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_NETWORK_VALUE_Q8,
  priceSats: WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS,
  registryAddress: WORK_AMO_V5_PRE_UNIT_RELIC_REGISTRY_ADDRESS,
  sellerAddress: WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS,
  sellerPublicKey: WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_PUBLIC_KEY,
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  version: WORK_AMO_V5_PRE_UNIT_RELIC_AUTH_VERSION,
  anchorSignature: "",
  anchorTxid: "",
};
const exactPreUnitRawPayload =
  `pwt1:list5:${Buffer.from(
    JSON.stringify(exactPreUnitAuthorization),
    "utf8",
  ).toString("base64url")}`;
assert.equal(
  Buffer.byteLength(exactPreUnitRawPayload, "utf8"),
  WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES,
  "The pre-unit fixture must preserve the exact canonical OP_RETURN bytes",
);
const exactPreUnitPayload = {
  _powEventIndex: WORK_AMO_V5_PRE_UNIT_RELIC_RECORD_ORDINAL,
  amount: "0.000016",
  amountAtoms: WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS,
  amountSats: WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  amountStorageModel: "work-atoms-v1",
  blockHash: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HASH,
  blockHeight: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT,
  blockIndex: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX,
  blockTime: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_TIME,
  canonicalVerifier: "/api/v1/internal/token-verifier",
  confirmed: true,
  createdAt: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_TIME,
  dataBytes: WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES,
  decimals: 8,
  dropped: false,
  indexedFrom: "token-listings",
  kind: "token-listing",
  listingId: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  minerFeeSats: WORK_AMO_V5_PRE_UNIT_RELIC_MINER_FEE_SATS,
  network: "livenet",
  participants: [WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS],
  payload: exactPreUnitRawPayload,
  priceSats: WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS,
  protocol: "pwt1",
  protocolVout: WORK_AMO_V5_PRE_UNIT_RELIC_PROTOCOL_VOUT,
  recipients: [
    {
      address: WORK_AMO_V5_PRE_UNIT_RELIC_REGISTRY_ADDRESS,
      amountSats: String(WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS),
      vout: 0,
    },
  ],
  registryAddress: WORK_AMO_V5_PRE_UNIT_RELIC_REGISTRY_ADDRESS,
  saleAuthorization: structuredClone(exactPreUnitAuthorization),
  saleTicketTxid: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  saleTicketValueSats: String(
    WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  ),
  saleTicketVout: WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT,
  sellerAddress: WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS,
  senderAddress: WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS,
  status: "confirmed",
  ticker: "WORK",
  timestamp: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_TIME,
  tokenId: WORK_TOKEN_ID,
  txid: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  unitScale: "100000000",
  valid: true,
  validationMode: "canonical-first-party-state",
};
const exactPreUnitRelicRow = () => ({
  anchor_address: WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS,
  anchor_scriptpubkey: WORK_AMO_V5_PRE_UNIT_RELIC_ANCHOR_SCRIPT_PUBKEY,
  anchor_value_sats: String(
    WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  ),
  block_hash: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HASH,
  block_height: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT,
  block_index: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX,
  block_time: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_TIME,
  canonical_block: true,
  canonical_close_closed_count: 0,
  canonical_close_count: 0,
  canonical_close_sale_count: 0,
  canonical_close_txid: null,
  canonical_spend_count: 0,
  canonical_spend_txid: null,
  definition_registry_address:
    WORK_AMO_V5_PRE_UNIT_RELIC_REGISTRY_ADDRESS,
  event_amount_sats: String(
    WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  ),
  event_data_bytes: WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES,
  event_id: 3_120_772,
  event_raw_payload: exactPreUnitRawPayload,
  event_status: "confirmed",
  event_txid: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  event_valid: true,
  kind: "token-listing",
  listing_event_count: 1,
  listing_event_payload: structuredClone(exactPreUnitPayload),
  listing_id: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  listing_payload_matches_event: true,
  listing_row_payload: structuredClone(exactPreUnitPayload),
  listing_status: "active",
  network: "livenet",
  output_spent_by_txid: null,
  pending_ticket_spend_count: 0,
  price_sats: String(WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS),
  protocol: "pwt1",
  protocol_vout: WORK_AMO_V5_PRE_UNIT_RELIC_PROTOCOL_VOUT,
  record_data_bytes: WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES,
  record_output_index: WORK_AMO_V5_PRE_UNIT_RELIC_RECORD_ORDINAL,
  record_payload_text: exactPreUnitRawPayload,
  record_protocol: "pwt1",
  record_vout: WORK_AMO_V5_PRE_UNIT_RELIC_PROTOCOL_VOUT,
  record_ordinal: WORK_AMO_V5_PRE_UNIT_RELIC_RECORD_ORDINAL,
  registry_payment_count: 1,
  registry_payment_sats: String(
    WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  ),
  registry_payment_vout: 0,
  sale_ticket_txid: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  sale_ticket_value_sats: String(
    WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS,
  ),
  sale_ticket_vout: WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT,
  seller_address: WORK_AMO_V5_PRE_UNIT_RELIC_SELLER_ADDRESS,
  ticker: "WORK",
  token_id: WORK_TOKEN_ID,
  transaction_block_height: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT,
  transaction_block_index: WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX,
  transaction_fee_sats: String(WORK_AMO_V5_PRE_UNIT_RELIC_MINER_FEE_SATS),
  transaction_status: "confirmed",
  valid_seal_count: 0,
  v1_declaration_count: 1,
  amount_atoms: WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS,
});
const incompletePreUnitEvidence = (rows, message) => {
  const evidence = workAmoV5PreUnitRelicEvidenceFromRows(
    rows,
    exactAmoActivation,
  );
  assert.equal(evidence.complete, false, message);
  return evidence;
};
const exactPreUnitRelicEvidence = workAmoV5PreUnitRelicEvidenceFromRows(
  [exactPreUnitRelicRow()],
  exactAmoActivation,
);
assert.equal(exactPreUnitRelicEvidence.complete, true);
assert.equal(exactPreUnitRelicEvidence.disposition, "relic");
assert.equal(exactPreUnitRelicEvidence.terminal, false);
assert.equal(exactPreUnitRelicEvidence.unspent, true);
assert.equal(exactPreUnitRelicEvidence.eventId, 3_120_772);
assert.equal(
  exactPreUnitRelicEvidence.model,
  WORK_AMO_V5_PRE_UNIT_RELIC_MODEL,
);
assert.equal(
  workAmoV5PreUnitRelicEvidenceIsExact(exactPreUnitRelicEvidence),
  true,
);

incompletePreUnitEvidence([], "Missing relic evidence must fail closed");
incompletePreUnitEvidence(
  [exactPreUnitRelicRow(), exactPreUnitRelicRow()],
  "Duplicate relic events must fail closed",
);
for (const [field, mismatch] of [
  ["event_id", null],
  ["listing_event_count", 2],
  ["event_txid", hash("4")],
  ["protocol", "pwm1"],
  ["kind", "token-sale"],
  ["event_status", "pending"],
  ["event_valid", false],
  ["canonical_block", false],
]) {
  const row = exactPreUnitRelicRow();
  row[field] = mismatch;
  incompletePreUnitEvidence(
    [row],
    `Mismatched canonical event field ${field} must fail closed`,
  );
}
for (const [field, mismatch] of [
  ["block_hash", hash("5")],
  ["block_height", WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT + 1],
  ["block_index", WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX + 1],
  ["protocol_vout", WORK_AMO_V5_PRE_UNIT_RELIC_PROTOCOL_VOUT + 1],
  ["record_ordinal", WORK_AMO_V5_PRE_UNIT_RELIC_RECORD_ORDINAL + 1],
  [
    "transaction_block_height",
    WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT + 1,
  ],
  [
    "transaction_block_index",
    WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_INDEX + 1,
  ],
]) {
  const row = exactPreUnitRelicRow();
  row[field] = mismatch;
  incompletePreUnitEvidence(
    [row],
    `Mismatched canonical coordinate ${field} must fail closed`,
  );
}
const authorizationMismatchRow = (field, mismatch) => {
  const row = exactPreUnitRelicRow();
  row.listing_event_payload.saleAuthorization[field] = mismatch;
  row.listing_row_payload.saleAuthorization[field] = mismatch;
  return row;
};
for (const [field, mismatch] of [
  ["version", "pwt-sale-v4"],
  ["amountAtoms", "1601"],
  ["priceSats", WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS + 1],
  ["anchorVout", WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT + 1],
  ["oracleBlockHeight", WORK_AMO_V5_PRE_UNIT_RELIC_ORACLE_BLOCK_HEIGHT + 1],
]) {
  incompletePreUnitEvidence(
    [authorizationMismatchRow(field, mismatch)],
    `Mismatched sale authorization field ${field} must fail closed`,
  );
}
for (const [field, wrongType] of [
  ["amountAtoms", Number(WORK_AMO_V5_PRE_UNIT_RELIC_AMOUNT_ATOMS)],
  ["anchorVout", String(WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT)],
  ["minimumPriceSats", WORK_AMO_V5_PRE_UNIT_RELIC_MINIMUM_PRICE_SATS],
  ["priceSats", String(WORK_AMO_V5_PRE_UNIT_RELIC_PRICE_SATS)],
]) {
  incompletePreUnitEvidence(
    [authorizationMismatchRow(field, wrongType)],
    `Wrong JSON type for sale authorization field ${field} must fail closed`,
  );
}
for (const [field, mismatch] of [
  ["listing_payload_matches_event", false],
  ["event_raw_payload", "pwt1:list5:broken"],
  ["record_payload_text", "pwt1:list5:broken"],
  ["event_data_bytes", WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES + 1],
  ["record_data_bytes", WORK_AMO_V5_PRE_UNIT_RELIC_DATA_BYTES + 1],
]) {
  const row = exactPreUnitRelicRow();
  row[field] = mismatch;
  incompletePreUnitEvidence(
    [row],
    `Mismatched payload evidence ${field} must fail closed`,
  );
}
for (const [field, mismatch] of [
  ["sale_ticket_txid", hash("6")],
  ["sale_ticket_vout", WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VOUT + 1],
  [
    "sale_ticket_value_sats",
    String(WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS + 1),
  ],
  ["anchor_address", "bc1qnottheseller"],
  ["anchor_scriptpubkey", `5120${"0".repeat(64)}`],
  [
    "anchor_value_sats",
    String(WORK_AMO_V5_PRE_UNIT_RELIC_TICKET_VALUE_SATS + 1),
  ],
  ["registry_payment_count", 0],
  ["registry_payment_sats", "0"],
  ["registry_payment_vout", 1],
  ["event_amount_sats", "0"],
  ["transaction_fee_sats", "0"],
]) {
  const row = exactPreUnitRelicRow();
  row[field] = mismatch;
  incompletePreUnitEvidence(
    [row],
    `Mismatched output or cost evidence ${field} must fail closed`,
  );
}
for (const [field, mismatch] of [
  ["v1_declaration_count", 0],
  ["pending_ticket_spend_count", 1],
]) {
  const row = exactPreUnitRelicRow();
  row[field] = mismatch;
  incompletePreUnitEvidence(
    [row],
    `Mismatched prerequisite ${field} must fail closed`,
  );
}
const terminalSpendTxid = hash("a");
const terminalSpendRow = exactPreUnitRelicRow();
Object.assign(terminalSpendRow, {
  canonical_spend_count: 1,
  canonical_spend_txid: terminalSpendTxid,
  output_spent_by_txid: terminalSpendTxid,
});
const terminalPreUnitRelicEvidence =
  workAmoV5PreUnitRelicEvidenceFromRows(
    [terminalSpendRow],
    exactAmoActivation,
  );
assert.equal(terminalPreUnitRelicEvidence.complete, true);
assert.equal(terminalPreUnitRelicEvidence.disposition, "terminal");
assert.equal(terminalPreUnitRelicEvidence.terminal, true);
assert.equal(terminalPreUnitRelicEvidence.unspent, false);
assert.equal(terminalPreUnitRelicEvidence.listing, undefined);
assert.equal(
  workAmoV5PreUnitRelicEvidenceIsExact(terminalPreUnitRelicEvidence),
  true,
);
for (const field of [
  "canonicalCloseCount",
  "canonicalCloseSaleCount",
  "canonicalCloseClosedCount",
]) {
  const validCount = terminalPreUnitRelicEvidence[field];
  for (const malformed of [
    0.5,
    String(validCount),
    null,
    Number.NaN,
  ]) {
    const malformedTerminalEvidence = structuredClone(
      terminalPreUnitRelicEvidence,
    );
    malformedTerminalEvidence[field] = malformed;
    assert.equal(
      workAmoV5PreUnitRelicEvidenceIsExact(
        malformedTerminalEvidence,
      ),
      false,
      `${field} must be an exact safe integer`,
    );
  }
}
for (const [evidence, expectedCount] of [
  [exactPreUnitRelicEvidence, 0],
  [terminalPreUnitRelicEvidence, 1],
]) {
  for (const malformed of [
    0.5,
    String(expectedCount),
    null,
    false,
    "",
    Number.NaN,
  ]) {
    const malformedSpendEvidence = structuredClone(evidence);
    malformedSpendEvidence.canonicalSpendCount = malformed;
    assert.equal(
      workAmoV5PreUnitRelicEvidenceIsExact(
        malformedSpendEvidence,
      ),
      false,
      "canonicalSpendCount must be an exact safe integer",
    );
  }
}
const terminalCloseAndSpendRow = structuredClone(terminalSpendRow);
Object.assign(terminalCloseAndSpendRow, {
  canonical_close_closed_count: 1,
  canonical_close_count: 1,
  canonical_close_sale_count: 0,
  canonical_close_txid: terminalSpendTxid,
});
assert.equal(
  workAmoV5PreUnitRelicEvidenceFromRows(
    [terminalCloseAndSpendRow],
    exactAmoActivation,
  ).complete,
  true,
  "A matching canonical close and exact ticket spend must be terminal",
);
const terminalPurchasePairRow = structuredClone(terminalSpendRow);
Object.assign(terminalPurchasePairRow, {
  canonical_close_closed_count: 1,
  canonical_close_count: 1,
  canonical_close_sale_count: 1,
  canonical_close_txid: terminalSpendTxid,
});
assert.equal(
  workAmoV5PreUnitRelicEvidenceFromRows(
    [terminalPurchasePairRow],
    exactAmoActivation,
  ).complete,
  true,
  "One close plus one sale from the canonical ticket spend is one terminal purchase",
);
const duplicateTerminalSaleRow = structuredClone(terminalPurchasePairRow);
duplicateTerminalSaleRow.canonical_close_sale_count = 2;
incompletePreUnitEvidence(
  [duplicateTerminalSaleRow],
  "Duplicate sale records in one terminal transaction must fail closed",
);
const closeOnlyRow = exactPreUnitRelicRow();
Object.assign(closeOnlyRow, {
  canonical_close_closed_count: 1,
  canonical_close_count: 1,
  canonical_close_sale_count: 0,
  canonical_close_txid: terminalSpendTxid,
});
incompletePreUnitEvidence(
  [closeOnlyRow],
  "A close event without the canonical ticket spend must fail closed",
);
const pointerOnlyRow = exactPreUnitRelicRow();
pointerOnlyRow.output_spent_by_txid = terminalSpendTxid;
incompletePreUnitEvidence(
  [pointerOnlyRow],
  "A spend pointer without canonical input evidence must fail closed",
);
const mismatchedTerminalRow = structuredClone(terminalSpendRow);
mismatchedTerminalRow.output_spent_by_txid = hash("b");
incompletePreUnitEvidence(
  [mismatchedTerminalRow],
  "Mismatched canonical spend and output pointer must fail closed",
);
const invalidVoutThreeRow = exactPreUnitRelicRow();
Object.assign(invalidVoutThreeRow, {
  invalid_related_event_count: 1,
  other_output_spend_count: 1,
  other_output_spent_by_txid:
    "8d5dd9599d8a372a6f68833cc844a7610120041ba3412baff62a21d74e5c8ad0",
  other_output_vout: 3,
});
assert.equal(
  workAmoV5PreUnitRelicEvidenceFromRows(
    [invalidVoutThreeRow],
    exactAmoActivation,
  ).disposition,
  "relic",
  "An invalid action spending vout 3 must not close the vout 2 ticket",
);

const listingFixture = (listingId, version, blockHeight) => ({
  blockHeight,
  confirmed: true,
  listingId,
  network: "livenet",
  saleAuthorization: {
    tokenId: WORK_TOKEN_ID,
    version,
  },
  status: "active",
  tokenId: WORK_TOKEN_ID,
  txid: listingId,
});
const unprojectedAmoListings = {
  closedListings: [],
  indexedThroughBlock: WORK_AMO_V5_ACTIVATION_HEIGHT,
  invalidEvents: [],
  listings: [
    listingFixture(
      WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
      "pwt-sale-v3",
      WORK_AMO_V5_PRE_UNIT_RELIC_BLOCK_HEIGHT,
    ),
    listingFixture(
      postUnitInvalidListingId,
      "pwt-sale-v3",
      WORK_AMO_V5_V1_ACTIVATION_HEIGHT,
    ),
    listingFixture(
      grandfatheredV4ListingId,
      WORK_AMO_V4_AUTH_VERSION,
      WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
    ),
  ],
  network: "livenet",
  stats: {
    activeListings: 3,
    confirmedOpenListings: 3,
    invalidEvents: 0,
    openListings: 3,
    pendingOpenListings: 0,
    relicListings: 0,
  },
  tokens: [
    {
      confirmedOpenListings: 3,
      openListings: 3,
      pendingOpenListings: 0,
      tokenId: WORK_TOKEN_ID,
    },
  ],
  totalCounts: {
    closedListings: 0,
    listings: 3,
  },
  workAmoV5Activation: exactAmoActivation,
};
const missingRelicProjection = applyWorkAmoV5CutoverToTokenState({
  ...unprojectedAmoListings,
  workAmoV5PreUnitRelicEvidence: {
    complete: false,
    model: WORK_AMO_V5_PRE_UNIT_RELIC_MODEL,
  },
});
assert.deepEqual(
  missingRelicProjection.listings.map(({ listingId }) => listingId),
  [grandfatheredV4ListingId],
  "Missing evidence must suppress legacy WORK reservations while preserving V4",
);
assert.equal(missingRelicProjection.closedListings.length, 0);
assert.equal(missingRelicProjection.stats.relicListings, 0);
assert.deepEqual(missingRelicProjection.totalCounts, {
  closedListings: 0,
  listings: 1,
});
assert.deepEqual(
  {
    confirmedOpenListings:
      missingRelicProjection.tokens[0].confirmedOpenListings,
    openListings: missingRelicProjection.tokens[0].openListings,
    pendingOpenListings:
      missingRelicProjection.tokens[0].pendingOpenListings,
  },
  {
    confirmedOpenListings: 1,
    openListings: 1,
    pendingOpenListings: 0,
  },
);
assert.equal(missingRelicProjection.workAmoV5ProjectionReady, false);
const projectedAmoListings = applyWorkAmoV5CutoverToTokenState(
  {
    ...unprojectedAmoListings,
    workAmoV5PreUnitRelicEvidence: exactPreUnitRelicEvidence,
  },
);
assert.deepEqual(
  projectedAmoListings.listings.map(({ listingId }) => listingId),
  [grandfatheredV4ListingId],
  "AMO projection must preserve only the grandfathered V4 listing as active",
);
assert.deepEqual(
  projectedAmoListings.closedListings.find(
    ({ listingId }) =>
      listingId === WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
  ),
  {
    ...exactPreUnitRelicEvidence.listing,
    closedAt: exactAmoActivationBlockTime,
    closedConfirmed: true,
    closedTxid: WORK_AMO_V5_DECLARATION_TXID,
    confirmed: true,
    disabledAtBlockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    disabledByTxid: WORK_AMO_V5_DECLARATION_TXID,
    disabledReason: WORK_AMO_V5_PRE_UNIT_RELIC_DISABLED_REASON,
    kind: "token-listing-closed",
    listingId: WORK_AMO_V5_PRE_UNIT_RELIC_LISTING_TXID,
    originalStatus: "active",
    refundEligible: false,
    relic: true,
    status: "disabled",
    txid: WORK_AMO_V5_DECLARATION_TXID,
  },
);
assert.equal(
  projectedAmoListings.stats.activeListings,
  1,
);
assert.equal(projectedAmoListings.stats.confirmedOpenListings, 1);
assert.equal(projectedAmoListings.stats.relicListings, 1);
assert.deepEqual(projectedAmoListings.totalCounts, {
  closedListings: 1,
  listings: 1,
});
assert.equal(projectedAmoListings.workAmoV5ProjectionReady, true);
const terminalRelicProjection = applyWorkAmoV5CutoverToTokenState({
  ...unprojectedAmoListings,
  workAmoV5PreUnitRelicEvidence: terminalPreUnitRelicEvidence,
});
assert.deepEqual(
  terminalRelicProjection.listings.map(({ listingId }) => listingId),
  [grandfatheredV4ListingId],
  "Terminal ticket evidence must suppress the V3 reservation and preserve V4",
);
assert.equal(terminalRelicProjection.closedListings.length, 0);
assert.equal(terminalRelicProjection.stats.relicListings, 0);
assert.deepEqual(terminalRelicProjection.totalCounts, {
  closedListings: 0,
  listings: 1,
});
assert.equal(terminalRelicProjection.workAmoV5ProjectionReady, true);
assert.deepEqual(
  applyWorkAmoV5CutoverToTokenState(missingRelicProjection),
  missingRelicProjection,
  "Missing-evidence projection must be idempotent",
);
assert.deepEqual(
  applyWorkAmoV5CutoverToTokenState(projectedAmoListings),
  projectedAmoListings,
  "AMO listing projection must be idempotent",
);

const genericTokenId = hash("7");
const exactGenericBalance = "9007199254740993";
const exactGenericPreimage =
  workAmoV5GenericTokenStatePreimageFromRows({
    balanceRows: [
      {
        address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        confirmed_balance: exactGenericBalance,
        token_id: genericTokenId,
      },
    ],
    blockHash: hash("8"),
    blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
    definitionRows: [
      {
        max_supply: "10000000000000000000",
        mint_amount: "9007199254740995",
        mint_price_sats: "9007199254740997",
        registry_address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        ticker: "EXACT",
        token_id: genericTokenId,
      },
    ],
    listingRows: [],
  });
assert.equal(exactGenericPreimage.complete, true);
assert.equal(
  exactGenericPreimage.tokens[0].maxSupply,
  "10000000000000000000",
);
assert.equal(
  exactGenericPreimage.tokens[0].mintAmount,
  "9007199254740995",
);
assert.equal(
  exactGenericPreimage.tokens[0].mintPriceSats,
  "9007199254740997",
);
assert.equal(
  exactGenericPreimage.tokens[0].confirmedSupplyAtoms,
  exactGenericBalance,
);
assert.equal(exactGenericPreimage.holders[0].balance, exactGenericBalance);
assert.notEqual(String(Number(exactGenericBalance)), exactGenericBalance);
assert.equal(
  normalizeWorkAmoV5RawGenericState(
    exactGenericPreimage,
  ).holders[0].balance,
  exactGenericBalance,
);
assert.equal(WORK_AMO_V5_V1_DECLARATION_HEIGHT, 959_305);
assert.equal(WORK_AMO_V5_V1_ACTIVATION_HEIGHT, 959_306);
assert.equal(
  WORK_AMO_V5_V1_DECLARATION_BLOCK_HASH,
  "00000000000000000000e82cdcdca5f072924d79790f2e4301330d4338d8eb30",
);
assert.equal(WORK_AMO_V5_V1_DECLARATION_BLOCK_INDEX, 1_187);

const canonicalPosition = (
  blockHeight,
  blockTransactionIndex,
  protocolVout = 1,
  recordOrdinal = 0,
  blockHash = hash("a"),
) => ({
  blockHash,
  blockHeight,
  blockTransactionIndex,
  protocolVout,
  recordOrdinal,
});

const declarationEvidence = {
  blockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
  blockHeight: WORK_AMO_V5_DECLARATION_HEIGHT,
  blockTransactionIndex: WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
  canonical: true,
  confirmed: true,
  firstInputPrevoutScriptPubKey:
    WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  payloadBytes: WORK_AMO_V5_DECLARATION_PAYLOAD_BYTES,
  payloadSha256: WORK_AMO_V5_DECLARATION_PAYLOAD_SHA256,
  protocolVout: WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT,
  recordOrdinal: WORK_AMO_V5_DECLARATION_RECORD_ORDINAL,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  registryPaymentSats: WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  registryPaymentVout: WORK_AMO_V5_DECLARATION_REGISTRY_PAYMENT_VOUT,
  txid: WORK_AMO_V5_DECLARATION_TXID,
  workProtocolVout: WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT,
};

const declarationValidation =
  validateWorkAmoV5DeclarationEvidence(declarationEvidence);
assert.equal(declarationValidation.valid, true);
assert.equal(
  declarationValidation.activation.activationHeight,
  WORK_AMO_V5_ACTIVATION_HEIGHT,
);
assert.deepEqual(
  workAmoV5ActivationFromEvidence(declarationEvidence),
  declarationValidation.activation,
);
assert.equal(
  workAmoV5ActivationReached(
    declarationValidation.activation,
    WORK_AMO_V5_ACTIVATION_HEIGHT,
  ),
  true,
);
assert.equal(
  workAmoV5ActivationReached(
    declarationValidation.activation,
    WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
  ),
  false,
);

for (const [field, value, reasonCode] of [
  ["canonical", false, "work-amo-v5-declaration-unconfirmed"],
  ["txid", hash("1"), "work-amo-v5-declaration-txid-mismatch"],
  [
    "blockTransactionIndex",
    WORK_AMO_V5_DECLARATION_BLOCK_INDEX + 1,
    "work-amo-v5-declaration-position-mismatch",
  ],
  [
    "firstInputPrevoutScriptPubKey",
    "00",
    "work-amo-v5-declaration-authority-mismatch",
  ],
  [
    "payloadSha256",
    hash("2"),
    "work-amo-v5-declaration-payload-mismatch",
  ],
  [
    "registryPaymentSats",
    WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS - 1,
    "work-amo-v5-declaration-registry-payment-invalid",
  ],
  [
    "registryAddress",
    "",
    "work-amo-v5-declaration-registry-payment-invalid",
  ],
  [
    "registryPaymentVout",
    WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT,
    "work-amo-v5-declaration-output-order-invalid",
  ],
]) {
  assert.equal(
    validateWorkAmoV5DeclarationEvidence({
      ...declarationEvidence,
      [field]: value,
    }).reasonCode,
    reasonCode,
    `declaration ${field} must fail closed`,
  );
}
assert.equal(
  validateWorkAmoV5DeclarationEvidence({
    ...declarationEvidence,
    registryPaymentSats: WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS + 1,
  }).valid,
  true,
);
const missingDeclarationPosition = { ...declarationEvidence };
delete missingDeclarationPosition.recordOrdinal;
assert.equal(
  validateWorkAmoV5DeclarationEvidence(missingDeclarationPosition).reasonCode,
  "work-amo-v5-declaration-position-unavailable",
);
const genericDeclarationAuthority = { ...declarationEvidence };
delete genericDeclarationAuthority.firstInputPrevoutScriptPubKey;
genericDeclarationAuthority.authorityScriptPubKey =
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY;
assert.equal(
  validateWorkAmoV5DeclarationEvidence(genericDeclarationAuthority).reasonCode,
  "work-amo-v5-declaration-authority-mismatch",
);

const activeStatus = workAmoV5StatusFromEvidence(declarationEvidence, {
  indexReady: true,
  quoteHead: null,
  tipHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
  writesConfigured: true,
});
assert.equal(activeStatus.active, true);
assert.equal(activeStatus.quoteReady, false);
assert.equal(activeStatus.protocolWritesEnabled, true);
assert.equal(activeStatus.listingWritesEnabled, false);
assert.equal(activeStatus.writes, false);
assert.equal(activeStatus.writesEnabled, false);
assert.equal(activeStatus.reasonCode, "work-amo-v5-quote-not-ready");
assert.deepEqual(
  activeStatus.allowedFaceUsdCents,
  WORK_AMO_V5_ALLOWED_FACE_USD_CENTS,
);

const positionA = canonicalPosition(
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  10,
  1,
  0,
);
const positionB = canonicalPosition(
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  10,
  2,
  0,
);
const positionC = canonicalPosition(
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  11,
  0,
  0,
);
assert.deepEqual(normalizeWorkAmoCanonicalPosition(positionA), positionA);
assert.equal(compareWorkAmoCanonicalPositions(positionA, positionB), -1);
assert.equal(compareWorkAmoCanonicalPositions(positionB, positionC), -1);
assert.equal(workAmoCanonicalPositionPrecedes(positionA, positionB), true);
assert.equal(
  workAmoCanonicalPositionPrecedes(
    positionA,
    { ...positionB, blockHash: hash("b") },
  ),
  false,
);
assert.throws(
  () =>
    compareWorkAmoCanonicalPositions(
      positionA,
      { ...positionB, recordOrdinal: undefined },
    ),
  TypeError,
);

const quotePayload = (sequence, previousQuoteTxid, priceQ8 = "100000000") =>
  `pwa1:usd1:${WORK_AMO_V5_V1_DECLARATION_TXID}:${sequence}:${previousQuoteTxid}:${priceQ8}`;
const quoteEvidence = ({
  blockHash = hash("a"),
  blockHeight = WORK_AMO_V5_ACTIVATION_HEIGHT,
  blockTransactionIndex,
  previousQuoteTxid,
  protocolVout = 1,
  sequence,
  txid,
  usdPer100mProofsQ8 = "100000000",
}) => ({
  blockHash,
  blockHeight,
  blockTransactionIndex,
  canonical: true,
  confirmed: true,
  firstInputPrevoutScriptPubKey:
    WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  payload: quotePayload(
    sequence,
    previousQuoteTxid,
    usdPer100mProofsQ8,
  ),
  protocolVout,
  recordCount: 1,
  recordOrdinal: 0,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  registryPaymentSats: WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  txid,
});

assert.deepEqual(
  parseWorkAmoUsdQuoteRecord(
    quotePayload(1, WORK_AMO_V5_V1_DECLARATION_TXID),
  ),
  {
    payload: quotePayload(1, WORK_AMO_V5_V1_DECLARATION_TXID),
    previousQuoteTxid: WORK_AMO_V5_V1_DECLARATION_TXID,
    sequence: "1",
    usdPer100mProofsQ8: "100000000",
    v1DeclarationTxid: WORK_AMO_V5_V1_DECLARATION_TXID,
  },
);
assert.equal(
  parseWorkAmoUsdQuoteRecord(
    quotePayload("01", WORK_AMO_V5_V1_DECLARATION_TXID),
  ),
  null,
);
assert.equal(
  parseWorkAmoUsdQuoteRecord(
    quotePayload(1, WORK_AMO_V5_V1_DECLARATION_TXID, "0"),
  ),
  null,
);
const validQuotePayload = quotePayload(
  1,
  WORK_AMO_V5_V1_DECLARATION_TXID,
);
assert.equal(
  [
    validQuotePayload,
    "pwa1:evil",
    `${validQuotePayload}:malformed`,
  ].filter((record) => parseWorkAmoUsdQuoteRecord(record)).length,
  1,
);
assert.equal(
  [validQuotePayload, validQuotePayload].filter((record) =>
    parseWorkAmoUsdQuoteRecord(record)
  ).length,
  2,
);

const losingFirstTxid = hash("1");
const winningFirstTxid = hash("f");
const winningSecondTxid = hash("e");
const losingSecondTxid = hash("2");
const orphanTxid = hash("3");
const losingFirst = quoteEvidence({
  blockTransactionIndex: 10,
  previousQuoteTxid: WORK_AMO_V5_V1_DECLARATION_TXID,
  sequence: 1,
  txid: losingFirstTxid,
});
const winningFirst = quoteEvidence({
  blockTransactionIndex: 5,
  previousQuoteTxid: WORK_AMO_V5_V1_DECLARATION_TXID,
  sequence: 1,
  txid: winningFirstTxid,
});
const winningSecond = quoteEvidence({
  blockTransactionIndex: 20,
  previousQuoteTxid: winningFirstTxid,
  sequence: 2,
  txid: winningSecondTxid,
  usdPer100mProofsQ8: "200000000",
});
const losingSecond = quoteEvidence({
  blockTransactionIndex: 30,
  previousQuoteTxid: winningFirstTxid,
  sequence: 2,
  txid: losingSecondTxid,
});
const orphan = quoteEvidence({
  blockTransactionIndex: 15,
  previousQuoteTxid: losingFirstTxid,
  sequence: 2,
  txid: orphanTxid,
});
const preV5QuoteEvidence = quoteEvidence({
  blockHash: hash("9"),
  blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
  blockTransactionIndex: 140,
  previousQuoteTxid: WORK_AMO_V5_V1_DECLARATION_TXID,
  sequence: 1,
  txid: hash("9"),
});
const preV5QuoteValidation =
  validateWorkAmoUsdQuoteEvidence(preV5QuoteEvidence);
assert.equal(preV5QuoteValidation.valid, true);
assert.equal(
  validateWorkAmoUsdQuoteEvidence({
    ...preV5QuoteEvidence,
    blockHeight: WORK_AMO_V5_V1_ACTIVATION_HEIGHT - 1,
  }).reasonCode,
  "work-amo-v5-quote-position-unavailable",
);
assert.equal(validateWorkAmoUsdQuoteEvidence(winningFirst).valid, true);
assert.equal(
  validateWorkAmoUsdQuoteEvidence({
    ...winningFirst,
    canonical: false,
  }).reasonCode,
  "work-amo-v5-quote-unconfirmed",
);
assert.equal(
  validateWorkAmoUsdQuoteEvidence({
    ...winningFirst,
    recordCount: 2,
  }).reasonCode,
  "work-amo-v5-quote-record-count-invalid",
);
assert.equal(
  validateWorkAmoUsdQuoteEvidence({
    ...winningFirst,
    registryAddress: "",
  }).reasonCode,
  "work-amo-v5-quote-registry-payment-insufficient",
);
const genericQuoteAuthority = { ...winningFirst };
delete genericQuoteAuthority.firstInputPrevoutScriptPubKey;
genericQuoteAuthority.authorityScriptPubKey =
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY;
assert.equal(
  validateWorkAmoUsdQuoteEvidence(genericQuoteAuthority).reasonCode,
  "work-amo-v5-quote-authority-invalid",
);

const selectedChain = selectCanonicalWorkAmoUsdQuoteChain([
  losingSecond,
  orphan,
  losingFirst,
  winningSecond,
  winningFirst,
]);
assert.equal(selectedChain.valid, true);
const readerShapeHead = {
  ...selectedChain.head,
  declarationTxid: selectedChain.head.v1DeclarationTxid,
};
delete readerShapeHead.v1DeclarationTxid;
assert.equal(
  workAmoV5StatusFromEvidence(declarationEvidence, {
    indexReady: true,
    quoteHead: readerShapeHead,
    tipHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    writesConfigured: true,
  }).quoteReady,
  true,
);
assert.deepEqual(
  selectedChain.chain.map((quote) => quote.txid),
  [winningFirstTxid, winningSecondTxid],
);
assert.equal(selectedChain.head.txid, winningSecondTxid);
assert.equal(
  selectedChain.rejected.find((item) => item.txid === losingFirstTxid)
    ?.reasonCode,
  "work-amo-v5-quote-competing-child",
);
assert.equal(
  selectedChain.rejected.find((item) => item.txid === orphanTxid)?.reasonCode,
  "work-amo-v5-quote-not-canonical-chain",
);
const duplicateEvidenceChain = selectCanonicalWorkAmoUsdQuoteChain([
  winningFirst,
  structuredClone(winningFirst),
]);
assert.equal(duplicateEvidenceChain.head.txid, winningFirstTxid);
assert.equal(
  duplicateEvidenceChain.rejected[0]?.reasonCode,
  "work-amo-v5-quote-evidence-duplicate",
);
const inconsistentDuplicate = {
  ...winningFirst,
  blockTransactionIndex: winningFirst.blockTransactionIndex + 1,
};
for (const records of [
  [winningFirst, inconsistentDuplicate],
  [inconsistentDuplicate, winningFirst],
]) {
  const inconsistentChain =
    selectCanonicalWorkAmoUsdQuoteChain(records);
  assert.equal(inconsistentChain.head, null);
  assert.ok(
    inconsistentChain.rejected.some(
      (item) =>
        item.reasonCode === "work-amo-v5-quote-txid-inconsistent",
    ),
  );
}
const conflictingForkQuote = {
  ...winningFirst,
  blockHash: hash("b"),
  txid: hash("6"),
};
const forkConflict = selectCanonicalWorkAmoUsdQuoteChain([
  winningFirst,
  conflictingForkQuote,
]);
assert.equal(forkConflict.valid, false);
assert.equal(forkConflict.head, null);
assert.equal(
  forkConflict.reasonCode,
  "work-amo-v5-quote-canonical-fork-conflict",
);

const listingAfterSecond = canonicalPosition(
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  25,
  0,
  0,
);
assert.equal(
  selectWorkAmoUsdQuoteBeforeListing(
    selectedChain.chain,
    listingAfterSecond,
  ).quote.txid,
  winningSecondTxid,
);
assert.equal(
  selectWorkAmoUsdQuoteBeforeListing(
    selectedChain.chain,
    canonicalPosition(WORK_AMO_V5_ACTIVATION_HEIGHT, 15, 0, 0),
  ).quote.txid,
  winningFirstTxid,
);

const sameTransactionQuote = {
  ...selectedChain.chain[0],
  blockTransactionIndex: 50,
  protocolVout: 1,
};
const sameTransactionListing = canonicalPosition(
  sameTransactionQuote.blockHeight,
  50,
  2,
  0,
  sameTransactionQuote.blockHash,
);
assert.equal(
  workAmoCanonicalPositionPrecedes(
    sameTransactionQuote,
    sameTransactionListing,
  ),
  true,
);

const boundaryQuoteEvidence = quoteEvidence({
  blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
  blockTransactionIndex: 1,
  previousQuoteTxid: WORK_AMO_V5_V1_DECLARATION_TXID,
  sequence: 1,
  txid: hash("4"),
});
const boundaryChain =
  selectCanonicalWorkAmoUsdQuoteChain([boundaryQuoteEvidence]).chain;
assert.equal(
  selectWorkAmoUsdQuoteBeforeListing(
    boundaryChain,
    canonicalPosition(
      WORK_AMO_V5_ACTIVATION_HEIGHT + WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
      1,
      1,
      0,
      hash("c"),
    ),
  ).valid,
  true,
);
assert.equal(
  selectWorkAmoUsdQuoteBeforeListing(
    boundaryChain,
    canonicalPosition(
      WORK_AMO_V5_ACTIVATION_HEIGHT +
        WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS +
        1,
      1,
      1,
      0,
      hash("d"),
    ),
  ).reasonCode,
  "work-amo-v5-quote-expired",
);

assert.equal(workAmoCeilDiv(10n, 3n), 4n);
assert.equal(workAmoFloorDiv(10n, 3n), 3n);
assert.throws(() => workAmoCeilDiv(1n, 0n), RangeError);
assert.throws(() => workAmoFloorDiv(-1n, 1n), RangeError);

const networkValueBeforeQ8 = "2100000000000000";
for (const unitFaceUsdCents of WORK_AMO_V5_ALLOWED_FACE_USD_CENTS) {
  const calculated = calculateWorkAmoV5UnitTerms({
    networkValueBeforeQ8,
    unitFaceUsdCents,
    usdPer100mProofsQ8: "100000000",
  });
  assert.equal(calculated.valid, true);
  const numerator =
    BigInt(unitFaceUsdCents) * 100000000n * 100000000n;
  const denominator = 100n * 100000000n;
  const expectedPrice = (numerator + denominator - 1n) / denominator;
  const expectedAmount =
    (numerator * 21000000n * 100000000n * 100000000n) /
    (denominator * BigInt(networkValueBeforeQ8));
  const minimumDenominator =
    21000000n * 100000000n * 100000000n;
  const expectedMinimum =
    (expectedAmount * BigInt(networkValueBeforeQ8) +
      minimumDenominator -
      1n) /
    minimumDenominator;
  assert.equal(calculated.unitPriceSats, expectedPrice.toString());
  assert.equal(calculated.unitAmountAtoms, expectedAmount.toString());
  assert.equal(
    calculated.unitMinimumPriceSats,
    expectedMinimum.toString(),
  );
  assert.ok(BigInt(calculated.unitPriceSats) >= expectedMinimum);
}
for (const invalidFace of [0, 500, 1_000, 20_001, "2000"]) {
  assert.equal(
    calculateWorkAmoV5UnitTerms({
      networkValueBeforeQ8,
      unitFaceUsdCents: invalidFace,
      usdPer100mProofsQ8: "100000000",
    }).reasonCode,
    "work-amo-v5-face-unit-invalid",
  );
}
assert.equal(
  calculateWorkAmoV5UnitTerms({
    networkValueBeforeQ8: "02100000000000000",
    unitFaceUsdCents: 2_000,
    usdPer100mProofsQ8: "100000000",
  }).reasonCode,
  "work-amo-v5-network-value-before-invalid",
);

const staticAuthorization = {
  amountModel: WORK_AMO_V5_AMOUNT_MODEL,
  anchorScriptPubKey:
    "76a914111111111111111111111111111111111111111188ac",
  anchorSigHashType: 0x83,
  anchorType: "sale-ticket-v1",
  anchorValueSats: 546,
  anchorVout: 2,
  bondTransitionModel: WORK_AMO_V5_BOND_TRANSITION_MODEL,
  buyerAddress: "",
  expiresAt: "",
  network: "livenet",
  nonce: "amo-v5-test",
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  sellerAddress: "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv",
  sellerPublicKey: `02${"11".repeat(32)}`,
  stateOrderModel: WORK_AMO_V5_STATE_ORDER_MODEL,
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  unitFaceUsdCents: 2_000,
  unitModel: WORK_AMO_V5_UNIT_MODEL,
  unitUsdOracleModel: WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
  unitWorkOracleModel: WORK_AMO_V5_UNIT_WORK_ORACLE_MODEL,
  version: WORK_AMO_V5_AUTH_VERSION,
};
assert.equal(
  validateWorkAmoV5StaticAuthorization(staticAuthorization).valid,
  true,
);
for (const cents of WORK_AMO_V5_ALLOWED_FACE_USD_CENTS) {
  assert.equal(
    validateWorkAmoV5StaticAuthorization({
      ...staticAuthorization,
      unitFaceUsdCents: cents,
    }).valid,
    true,
  );
}
assert.equal(
  validateWorkAmoV5StaticAuthorization({
    ...staticAuthorization,
    unitFaceUsdCents: 1_000,
  }).reasonCode,
  "work-amo-v5-face-unit-invalid",
);
assert.equal(
  validateWorkAmoV5StaticAuthorization({
    ...staticAuthorization,
    amountAtoms: "1",
    priceSats: "1",
  }).reasonCode,
  "work-amo-v5-derived-fields-not-signable",
);
for (const invalidAddressAuthorization of [
  {
    ...staticAuthorization,
    sellerAddress: "not-a-livenet-address",
  },
  {
    ...staticAuthorization,
    buyerAddress: "not-a-livenet-address",
  },
]) {
  assert.equal(
    validateWorkAmoV5StaticAuthorization(
      invalidAddressAuthorization,
    ).reasonCode,
    "work-amo-v5-static-fields-invalid",
  );
}

const {
  amountModel: _v5AmountModel,
  bondTransitionModel: _v5BondTransitionModel,
  stateOrderModel: _v5StateOrderModel,
  unitModel: _v5UnitModel,
  unitUsdOracleModel: _v5UnitUsdOracleModel,
  unitWorkOracleModel: _v5UnitWorkOracleModel,
  ...historicalV4Identity
} = staticAuthorization;
const historicalV4Authorization = {
  ...historicalV4Identity,
  amountAtoms: "100000000",
  minimumPriceSats: "1",
  oracleModel: WORK_AMO_V4_ORACLE_MODEL,
  priceSats: "1000",
  unitFaceUsd: 10,
  unitFaceUsdCents: 1_000,
  unitModel: WORK_AMO_V4_UNIT_MODEL,
  unitNetworkValueQ8: networkValueBeforeQ8,
  unitUsdOracleModel: WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
  version: WORK_AMO_V4_AUTH_VERSION,
};
const historicalV4FrozenTerms = {
  authorizationVersion: WORK_AMO_V4_AUTH_VERSION,
  canonical: true,
  confirmed: true,
  listingBlockHash: hash("7"),
  listingBlockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
  listingBlockIndex: 100,
  listingProtocolVout: 3,
  listingRecordOrdinal: 0,
  tokenId: WORK_TOKEN_ID,
  unitAmountAtoms: historicalV4Authorization.amountAtoms,
  unitFaceUsd: 10,
  unitFaceUsdCents: 1_000,
  unitMinimumPriceSats: historicalV4Authorization.minimumPriceSats,
  unitNetworkValueBeforeQ8:
    historicalV4Authorization.unitNetworkValueQ8,
  unitPriceSats: historicalV4Authorization.priceSats,
  valid: true,
};
const historicalV5ReferenceAuthorization = {
  ...staticAuthorization,
  unitFaceUsdCents: 1_000,
};
const historicalReferenceValidation =
  validateWorkAmoV5ReferencedAuthorization(
    historicalV5ReferenceAuthorization,
    {
      listingAuthorization: historicalV4Authorization,
      listingFrozenTerms: historicalV4FrozenTerms,
    },
  );
assert.equal(historicalReferenceValidation.valid, true);
assert.equal(historicalReferenceValidation.grandfathered, true);
assert.equal(historicalReferenceValidation.listingFaceUsdCents, 1_000);
assert.equal(
  validateWorkAmoV5ReferencedAuthorization(
    {
      ...historicalV5ReferenceAuthorization,
      unitFaceUsdCents: 2_000,
    },
    {
      listingAuthorization: historicalV4Authorization,
      listingFrozenTerms: historicalV4FrozenTerms,
    },
  ).reasonCode,
  "work-amo-v5-reference-face-mismatch",
);
assert.equal(
  validateWorkAmoV5ReferencedAuthorization(
    {
      ...historicalV5ReferenceAuthorization,
      amountAtoms: historicalV4Authorization.amountAtoms,
    },
    {
      listingAuthorization: historicalV4Authorization,
      listingFrozenTerms: historicalV4FrozenTerms,
    },
  ).reasonCode,
  "work-amo-v5-derived-fields-not-signable",
);
assert.equal(
  validateWorkAmoV5ReferencedAuthorization(
    historicalV5ReferenceAuthorization,
    {
      listingAuthorization: historicalV4Authorization,
      listingFrozenTerms: {
        ...historicalV4FrozenTerms,
        listingBlockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
      },
    },
  ).reasonCode,
  "work-amo-v5-reference-listing-position-invalid",
);
assert.equal(
  validateWorkAmoV5ReferencedAuthorization(
    historicalV5ReferenceAuthorization,
    {
      listingAuthorization: {
        ...historicalV4Authorization,
        sellerAddress: "1HistoricalIdentityMismatch",
      },
      listingFrozenTerms: historicalV4FrozenTerms,
    },
  ).reasonCode,
  "work-amo-v5-reference-identity-mismatch",
);
assert.equal(
  validateWorkAmoV5ReferencedAuthorization(
    historicalV5ReferenceAuthorization,
    {
      listingAuthorization: historicalV4Authorization,
      listingFrozenTerms: {
        ...historicalV4FrozenTerms,
        valid: false,
      },
    },
  ).reasonCode,
  "work-amo-v5-reference-listing-not-canonical",
);
assert.equal(
  validateWorkAmoV5StaticAuthorization(
    historicalV5ReferenceAuthorization,
  ).reasonCode,
  "work-amo-v5-face-unit-invalid",
);

const frozenListingPosition = canonicalPosition(
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  25,
  2,
  0,
);
const listingBondContributionQ8 = "109200000000";
const derived = deriveWorkAmoV5FrozenTerms(staticAuthorization, {
  listingBondContributionQ8,
  listingPosition: frozenListingPosition,
  networkValueBeforeQ8,
  quote: selectedChain.head,
  spendableAmountAtoms: "210000000000000000",
});
assert.equal(derived.valid, true);
assert.equal(derived.frozenTerms.unitFaceUsd, 20);
assert.equal(derived.frozenTerms.unitFaceUsdCents, 2_000);
assert.equal(derived.frozenTerms.unitUsdQuoteTxid, winningSecondTxid);
assert.equal(
  Object.hasOwn(derived.frozenTerms, "unitUsdQuoteRecordOrdinal"),
  false,
);
assert.equal(
  derived.frozenTerms.unitNetworkValueAfterQ8,
  (
    BigInt(networkValueBeforeQ8) + BigInt(listingBondContributionQ8)
  ).toString(),
);
assert.equal(
  validateWorkAmoV5FrozenTerms(derived.frozenTerms, {
    authorization: staticAuthorization,
    listingBondContributionQ8,
    listingPosition: frozenListingPosition,
    networkValueBeforeQ8,
    quote: selectedChain.head,
  }).valid,
  true,
);
for (const missingRecordOrdinal of [undefined, null, ""]) {
  const incompleteFrozenTerms = structuredClone(derived.frozenTerms);
  if (missingRecordOrdinal === undefined) {
    delete incompleteFrozenTerms.listingRecordOrdinal;
  } else {
    incompleteFrozenTerms.listingRecordOrdinal = missingRecordOrdinal;
  }
  assert.equal(
    validateWorkAmoV5FrozenTerms(incompleteFrozenTerms).reasonCode,
    "work-amo-v5-frozen-terms-invalid",
  );
}
assert.equal(
  deriveWorkAmoV5FrozenTerms(staticAuthorization, {
    listingBondContributionQ8,
    listingPosition: frozenListingPosition,
    networkValueBeforeQ8,
    quote: selectedChain.head,
    spendableAmountAtoms: "0",
  }).reasonCode,
  "work-amo-v5-insufficient-spendable-balance",
);
assert.equal(
  deriveWorkAmoV5FrozenTerms(staticAuthorization, {
    listingBondContributionQ8,
    listingPosition: canonicalPosition(
      WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
      25,
      2,
      0,
    ),
    networkValueBeforeQ8,
    quote: selectedChain.head,
    spendableAmountAtoms: "210000000000000000",
  }).reasonCode,
  "work-amo-v5-listing-before-activation",
);
assert.equal(
  deriveWorkAmoV5FrozenTerms(staticAuthorization, {
    listingBondContributionQ8: "0",
    listingPosition: frozenListingPosition,
    networkValueBeforeQ8,
    quote: selectedChain.head,
    spendableAmountAtoms: "210000000000000000",
  }).reasonCode,
  "work-amo-v5-listing-bond-contribution-invalid",
);
assert.equal(
  deriveWorkAmoV5FrozenTerms(staticAuthorization, {
    listingBondContributionQ8,
    listingPosition: canonicalPosition(
      WORK_AMO_V5_ACTIVATION_HEIGHT,
      1,
      2,
      0,
      hash("8"),
    ),
    networkValueBeforeQ8,
    quote: preV5QuoteValidation.quote,
    spendableAmountAtoms: "210000000000000000",
  }).valid,
  true,
);

const changedPrice = {
  ...derived.frozenTerms,
  unitPriceSats: (
    BigInt(derived.frozenTerms.unitPriceSats) + 1n
  ).toString(),
};
assert.equal(
  validateWorkAmoV5FrozenTerms(changedPrice).reasonCode,
  "work-amo-v5-frozen-terms-invalid",
);
assert.equal(
  workAmoV5FrozenTermsMatch(derived.frozenTerms, changedPrice),
  false,
);
assert.equal(
  workAmoV5FrozenTermsMatch(
    derived.frozenTerms,
    structuredClone(derived.frozenTerms),
  ),
  true,
);

const laterActionPosition = canonicalPosition(
  WORK_AMO_V5_ACTIVATION_HEIGHT + 10,
  1,
  1,
  0,
  hash("d"),
);
assert.equal(
  validateWorkAmoV5SealOrBuyTerms({
    actionFrozenTerms: structuredClone(derived.frozenTerms),
    actionPosition: laterActionPosition,
    listingFrozenTerms: derived.frozenTerms,
    listingPosition: frozenListingPosition,
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV5SealOrBuyTerms({
    actionPosition: laterActionPosition,
    listingFrozenTerms: derived.frozenTerms,
    listingPosition: frozenListingPosition,
    referencesListingFrozenTerms: true,
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV5SealOrBuyTerms({
    actionFrozenTerms: derived.frozenTerms,
    actionPosition: canonicalPosition(
      WORK_AMO_V5_ACTIVATION_HEIGHT,
      20,
      1,
      0,
    ),
    listingFrozenTerms: derived.frozenTerms,
    listingPosition: frozenListingPosition,
  }).reasonCode,
  "work-amo-v5-action-not-after-listing",
);

const readyStatus = workAmoV5StatusFromEvidence(declarationEvidence, {
  indexReady: true,
  quoteHead: selectedChain.head,
  tipHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
  writesConfigured: true,
});
assert.equal(readyStatus.writesEnabled, true);
assert.equal(readyStatus.writes, true);
assert.equal(readyStatus.protocolWritesEnabled, true);
assert.equal(readyStatus.listingWritesEnabled, true);
assert.equal(readyStatus.reasonCode, "");
const staleQuoteStatus = workAmoV5StatusFromEvidence(declarationEvidence, {
  indexReady: true,
  quoteHead: selectedChain.head,
  tipHeight:
    selectedChain.head.blockHeight + WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
  writesConfigured: true,
});
assert.equal(staleQuoteStatus.quoteReady, false);
assert.equal(staleQuoteStatus.protocolWritesEnabled, true);
assert.equal(staleQuoteStatus.listingWritesEnabled, false);
assert.equal(staleQuoteStatus.writesEnabled, false);
assert.equal(staleQuoteStatus.reasonCode, "work-amo-v5-quote-expired");
const broadcastAction = {
  action: "list5",
  authVersion: WORK_AMO_V5_AUTH_VERSION,
  canonicalParsed: true,
  paysWorkRegistry: true,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  saleAuthorization: staticAuthorization,
  signedShapeValid: true,
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  tokenProtocolMessageCount: 1,
};
assert.deepEqual(
  workAmoV5BroadcastDecision([broadcastAction], {
    metadata: readyStatus,
    network: "livenet",
  }),
  { allowed: true },
);
assert.equal(
  workAmoV5BroadcastDecision(
    [{ ...broadcastAction, authVersion: "pwt-sale-v4" }],
    { metadata: readyStatus, network: "livenet" },
  ).code,
  "WORK_AMO_V5_REQUIRED",
);
assert.equal(
  workAmoV5BroadcastDecision(
    [{ ...broadcastAction, canonicalParsed: undefined }],
    { metadata: readyStatus, network: "livenet" },
  ).code,
  "WORK_AMO_V5_REQUIRED",
);
assert.equal(
  workAmoV5BroadcastDecision(
    [{ ...broadcastAction, action: "unknown" }],
    { metadata: readyStatus, network: "livenet" },
  ).code,
  "WORK_AMO_V5_TRANSACTION_INVALID",
);
assert.equal(
  workAmoV5BroadcastDecision(
    [
      {
        ...broadcastAction,
        action: "seal5",
        saleAuthorization: {
          ...staticAuthorization,
          unitFaceUsdCents: 1_000,
        },
      },
    ],
    { metadata: readyStatus, network: "livenet" },
  ).code,
  "WORK_AMO_V5_STATIC_AUTHORIZATION_INVALID",
);
assert.equal(
  workAmoV5BroadcastDecision([broadcastAction], {
    metadata: activeStatus,
    network: "livenet",
  }).code,
  "WORK_AMO_V5_WRITES_PAUSED",
);
assert.deepEqual(
  workAmoV5BroadcastDecision(
    [
      {
        ...broadcastAction,
        action: "seal5",
        listingFrozenTerms: derived.frozenTerms,
      },
    ],
    { metadata: activeStatus, network: "livenet" },
  ),
  { allowed: true },
);
assert.deepEqual(
  workAmoV5BroadcastDecision(
    [
      {
        ...broadcastAction,
        action: "seal5",
        listingAuthorization: historicalV4Authorization,
        listingFrozenTerms: historicalV4FrozenTerms,
        saleAuthorization: historicalV5ReferenceAuthorization,
      },
    ],
    { metadata: activeStatus, network: "livenet" },
  ),
  { allowed: true },
);
assert.deepEqual(
  workAmoV5BroadcastDecision(
    [
      {
        ...broadcastAction,
        action: "buy5",
        listingFrozenTerms: derived.frozenTerms,
      },
    ],
    { metadata: staleQuoteStatus, network: "livenet" },
  ),
  { allowed: true },
);
assert.equal(
  workAmoV5BroadcastDecision(
    [{ ...broadcastAction, action: "seal5" }],
    { metadata: activeStatus, network: "livenet" },
  ).code,
  "WORK_AMO_V5_FROZEN_TERMS_INVALID",
);

const sequencerBlockHash = hash("e");
const sequencerRecords = [];
for (let transactionIndex = 0; transactionIndex < 1_000; transactionIndex += 1) {
  const txid = transactionIndex.toString(16).padStart(64, "0");
  for (let recordOrdinal = 0; recordOrdinal < 3; recordOrdinal += 1) {
    sequencerRecords.push({
      invalid: transactionIndex === 0 && recordOrdinal === 1,
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT + 20,
        transactionIndex,
        1,
        recordOrdinal,
        sequencerBlockHash,
      ),
      transactionMinerFeeSats: transactionIndex === 0 ? "11" : "1",
      transactionProtocolRecordCount: 3,
      txid,
    });
  }
}
sequencerRecords.reverse();
const observedBefore = [];
const sequenced = replayWorkAmoV5CanonicalBlock({
  applyTransactionFee: ({ state, transaction }) => ({
    state: {
      n: state.n + BigInt(transaction.transactionMinerFeeSats),
    },
  }),
  blockHash: sequencerBlockHash,
  blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT + 20,
  evaluateRecord: ({ entry, networkValueBeforeQ8, state }) => {
    observedBefore.push(networkValueBeforeQ8);
    if (entry.invalid) {
      return {
        reasonCode: "fixture-invalid",
        valid: false,
      };
    }
    return {
      output: {
        frozenNetworkValueBeforeQ8: networkValueBeforeQ8.toString(),
      },
      state: { n: state.n + 7n },
      valid: true,
    };
  },
  openingState: { n: 100n },
  records: sequencerRecords,
  valueFromState: (state) => state.n,
});
assert.equal(sequenced.model, WORK_AMO_V5_BLOCK_SEQUENCER_MODEL);
assert.equal(sequenced.blockAtomic, true);
assert.equal(sequenced.feeOnce, true);
assert.equal(sequenced.invalidZero, true);
assert.equal(sequenced.protocolRecordCount, 3_000);
assert.equal(sequenced.transactionCount, 1_000);
assert.equal(sequenced.openingNetworkValueQ8, "100");
assert.equal(observedBefore[0], 100n);
assert.equal(observedBefore[1], 107n);
assert.equal(observedBefore[2], 107n);
assert.equal(
  sequenced.traces[0].output.frozenNetworkValueBeforeQ8,
  "100",
);
assert.equal(sequenced.traces[0].bondContributionQ8, "7");
assert.equal(sequenced.traces[1].valid, false);
assert.equal(sequenced.traces[1].bondContributionQ8, "0");
assert.equal(sequenced.traces[2].networkValueBeforeQ8, "107");
assert.equal(sequenced.traces[2].networkValueAfterQ8, "114");
assert.equal(sequenced.traces[3].kind, "transaction-fee");
assert.equal(sequenced.traces[3].networkValueBeforeQ8, "114");
assert.equal(sequenced.traces[3].networkValueAfterQ8, "125");
assert.equal(observedBefore[3], 125n);
assert.equal(
  sequenced.closingNetworkValueQ8,
  (
    100n +
    2_999n * 7n +
    11n +
    999n
  ).toString(),
);

const invalidOnlyFee = replayWorkAmoV5CanonicalBlock({
  applyTransactionFee: ({ state, transaction }) => ({
    state: transaction.hasValidCanonicalEvent
      ? { n: state.n + BigInt(transaction.transactionMinerFeeSats) }
      : state,
  }),
  blockHash: sequencerBlockHash,
  blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT + 20,
  evaluateRecord: () => ({
    reasonCode: "fixture-invalid",
    valid: false,
  }),
  openingState: { n: 10n },
  records: [
    {
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT + 20,
        1_001,
        1,
        0,
        sequencerBlockHash,
      ),
      transactionMinerFeeSats: "99",
      transactionProtocolRecordCount: 1,
      txid: hash("f"),
    },
  ],
  valueFromState: (state) => state.n,
});
assert.equal(invalidOnlyFee.closingNetworkValueQ8, "10");
assert.equal(invalidOnlyFee.traces.at(-1).valid, false);
assert.equal(
  invalidOnlyFee.traces.at(-1).reasonCode,
  "work-amo-v5-invalid-only-transaction",
);

const sameTxOrderingObservations = [];
const sameTxOrdering = replayWorkAmoV5CanonicalBlock({
  applyTransactionFee: ({ state, transaction }) => ({
    state: {
      ...state,
      n: state.n + BigInt(transaction.transactionMinerFeeSats),
    },
  }),
  blockHash: sequencerBlockHash,
  blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT + 21,
  evaluateRecord: ({ entry, networkValueBeforeQ8, state }) => {
    sameTxOrderingObservations.push({
      networkValueBeforeQ8,
      quoteSequence: state.quoteSequence,
    });
    return entry.position.protocolVout === 1
      ? {
          output: { quoteSequence: "1" },
          state: { n: state.n + 10n, quoteSequence: "1" },
          valid: true,
        }
      : {
          output: {
            frozenListingNetworkValueBeforeQ8:
              networkValueBeforeQ8.toString(),
          },
          state: { ...state, n: state.n + 7n },
          valid: true,
        };
  },
  openingState: { n: 100n, quoteSequence: "" },
  records: [
    {
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT + 21,
        4,
        2,
        0,
        sequencerBlockHash,
      ),
      transactionMinerFeeSats: "5",
      transactionProtocolRecordCount: 2,
      txid: hash("8"),
    },
    {
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT + 21,
        4,
        1,
        0,
        sequencerBlockHash,
      ),
      transactionMinerFeeSats: "5",
      transactionProtocolRecordCount: 2,
      txid: hash("8"),
    },
  ],
  valueFromState: (state) => state.n,
});
assert.deepEqual(sameTxOrderingObservations, [
  { networkValueBeforeQ8: 100n, quoteSequence: "" },
  { networkValueBeforeQ8: 110n, quoteSequence: "1" },
]);
assert.equal(
  sameTxOrdering.traces[1].output
    .frozenListingNetworkValueBeforeQ8,
  "110",
);
assert.equal(sameTxOrdering.traces[2].kind, "transaction-fee");
assert.equal(sameTxOrdering.traces[2].networkValueBeforeQ8, "117");
assert.equal(sameTxOrdering.closingNetworkValueQ8, "122");

const crossTxListingBefore = [];
replayWorkAmoV5CanonicalBlock({
  applyTransactionFee: ({ state, transaction }) => ({
    state: {
      ...state,
      n: state.n + BigInt(transaction.transactionMinerFeeSats),
    },
  }),
  blockHash: sequencerBlockHash,
  blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT + 22,
  evaluateRecord: ({ entry, networkValueBeforeQ8, state }) => {
    if (entry.position.blockTransactionIndex === 2) {
      crossTxListingBefore.push(networkValueBeforeQ8);
    }
    return {
      state: {
        ...state,
        n: state.n + 10n,
        quoteSequence:
          entry.position.blockTransactionIndex === 1
            ? "2"
            : state.quoteSequence,
      },
      valid: true,
    };
  },
  openingState: { n: 100n, quoteSequence: "1" },
  records: [
    {
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT + 22,
        1,
        1,
        0,
        sequencerBlockHash,
      ),
      transactionMinerFeeSats: "5",
      transactionProtocolRecordCount: 1,
      txid: hash("9"),
    },
    {
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT + 22,
        2,
        1,
        0,
        sequencerBlockHash,
      ),
      transactionMinerFeeSats: "3",
      transactionProtocolRecordCount: 1,
      txid: hash("a"),
    },
  ],
  valueFromState: (state) => state.n,
});
assert.deepEqual(crossTxListingBefore, [115n]);

const registryOutputs = [
  {
    address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    amountSats: 546,
    vout: 0,
  },
  {
    address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    amountSats: 546,
    vout: 2,
  },
];
const quoteRegistryPayment =
  selectWorkAmoV5DistinctRegistryPayment(registryOutputs, {
    claimedVouts: [],
    protocolVout: 1,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    requiredSats: 546,
  });
assert.equal(quoteRegistryPayment.registryPaymentVout, 0);
assert.equal(
  selectWorkAmoV5DistinctRegistryPayment(
    registryOutputs.slice(0, 1),
    {
      claimedVouts: [quoteRegistryPayment.registryPaymentVout],
      protocolVout: 3,
      registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      requiredSats: 546,
    },
  ),
  null,
);
assert.equal(
  selectWorkAmoV5DistinctRegistryPayment(
    [
      {
        address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        amountSats: 546,
        vout: 2,
      },
    ],
    {
      claimedVouts: [],
      protocolVout: 1,
      registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      requireBeforeProtocol: false,
      requiredSats: 546,
    },
  ).registryPaymentVout,
  2,
);
assert.equal(
  selectWorkAmoV5DistinctRegistryPayment(
    [
      {
        address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        amountSats: 546,
        vout: 2,
      },
    ],
    {
      claimedVouts: [],
      protocolVout: 1,
      registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      requireBeforeProtocol: true,
      requiredSats: 546,
    },
  ),
  null,
);
assert.equal(
  selectWorkAmoV5DistinctRegistryPayment(registryOutputs, {
    claimedVouts: [quoteRegistryPayment.registryPaymentVout],
    protocolVout: 3,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    requiredSats: 546,
  }).registryPaymentVout,
  2,
);
assert.equal(
  selectWorkAmoV5DistinctRegistryPayment(
    [{ ...registryOutputs[0], amountSats: 1_092 }],
    {
      claimedVouts: [0],
      protocolVout: 3,
      registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      requiredSats: 546,
    },
  ),
  null,
);

const splitEconomicOutputs = selectWorkAmoV5EconomicOutputs(
  [
    { address: "registry", amountSats: 300, vout: 0 },
    { address: "registry", amountSats: 400, vout: 1 },
    { address: "seller", amountSats: 2_000, vout: 2 },
  ],
  {
    address: "registry",
    claimedVouts: [],
    protocolVout: 3,
    requiredSats: 546,
    role: "pwt-token-registry",
  },
);
assert.deepEqual(splitEconomicOutputs, [
  {
    address: "registry",
    attributedSats: 300,
    outputSats: 300,
    role: "pwt-token-registry",
    vout: 0,
  },
  {
    address: "registry",
    attributedSats: 246,
    outputSats: 400,
    role: "pwt-token-registry",
    vout: 1,
  },
]);
assert.equal(
  selectWorkAmoV5EconomicOutputs(
    [{ address: "registry", amountSats: 1_092, vout: 0 }],
    {
      address: "registry",
      claimedVouts: [0],
      protocolVout: 2,
      requiredSats: 546,
      role: "pwt-token-registry",
    },
  ),
  null,
);
const sameAddressAssignment = assignWorkAmoV5EconomicOutputs(
  [
    { address: "same", amountSats: 1_000, vout: 0 },
    { address: "same", amountSats: 546, vout: 1 },
  ],
  [
    {
      address: "same",
      requiredSats: 546,
      role: "pwt-token-registry",
    },
    {
      address: "same",
      requiredSats: 1_000,
      role: "pwt-seller",
    },
  ],
  { protocolVout: 2 },
);
assert.deepEqual(
  sameAddressAssignment.economicOutputs.map(
    ({ attributedSats, role, vout }) => ({
      attributedSats,
      role,
      vout,
    }),
  ),
  [
    {
      attributedSats: 1_000,
      role: "pwt-seller",
      vout: 0,
    },
    {
      attributedSats: 546,
      role: "pwt-token-registry",
      vout: 1,
    },
  ],
);
assert.equal(
  assignWorkAmoV5EconomicOutputs(
    [{ address: "recipient", amountSats: 546, vout: 0 }],
    [
      {
        candidateVouts: [0],
        claimAll: true,
        role: "pwm-recipient",
      },
    ],
    { claimedVouts: [0], protocolVout: 1 },
  ),
  null,
);
const priorClaims = new Set([0]);
assert.equal(
  assignWorkAmoV5EconomicOutputs(
    [
      { address: "seller", amountSats: 1_000, vout: 1 },
      { address: "registry", amountSats: 546, vout: 2 },
    ],
    [
      {
        address: "seller",
        requiredSats: 1_000,
        role: "pwt-seller",
      },
      {
        address: "missing",
        requiredSats: 546,
        role: "pwt-token-registry",
      },
    ],
    { claimedVouts: priorClaims, protocolVout: 3 },
  ),
  null,
);
assert.deepEqual([...priorClaims], [0]);
const highOutputCount = 4_096;
const highOutputAssignment = assignWorkAmoV5EconomicOutputs(
  Array.from({ length: highOutputCount }, (_, vout) => ({
    address: "high-output-recipient",
    amountSats: 1,
    vout,
  })),
  [
    {
      address: "high-output-recipient",
      requiredSats: String(highOutputCount),
      role: "pwt-seller",
    },
  ],
  { protocolVout: highOutputCount },
);
assert.equal(highOutputAssignment.economicOutputs.length, highOutputCount);
assert.equal(
  highOutputAssignment.economicOutputs.reduce(
    (total, output) => total + output.attributedSats,
    0,
  ),
  highOutputCount,
);
assert.equal(
  selectWorkAmoV5EconomicOutputs(
    [
      { address: "first", amountSats: 500, vout: 0 },
      { address: "second", amountSats: 700, vout: 1 },
    ],
    {
      candidateVouts: [0, 1],
      claimAll: true,
      claimedVouts: [0],
      protocolVout: 2,
      role: "pwm-recipient",
    },
  ),
  null,
);
assert.deepEqual(
  parseWorkAmoV5RawPwtRecord(
    `pwt1:send2:${WORK_TOKEN_ID}:1:${WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS}`,
  ),
  {
    amountAtoms: "1",
    amountVersion: "send2",
    kind: "send",
    payload:
      `pwt1:send2:${WORK_TOKEN_ID}:1:${WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS}`,
    recipientAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    tokenId: WORK_TOKEN_ID,
  },
);
const rawV5Authorization = Buffer.from(
  JSON.stringify({ tokenId: WORK_TOKEN_ID }),
).toString("base64url");
assert.equal(
  parseWorkAmoV5RawPwtRecord(
    `pwt1:list5:${rawV5Authorization}`,
  )?.saleAuthorization?.tokenId,
  WORK_TOKEN_ID,
);

function base64UrlJsonWithInvalidUtf8(source) {
  const json = JSON.stringify(source);
  return Buffer.concat([
    Buffer.from(`${json.slice(0, -1)},"ignored":"`, "utf8"),
    Buffer.from([0x80]),
    Buffer.from('"}', "utf8"),
  ]).toString("base64url");
}

const rawGenericSaleAuthorization = {
  amount: 1,
  anchorScriptPubKey:
    "76a914111111111111111111111111111111111111111188ac",
  anchorSigHashType: 0x83,
  anchorSignature: "",
  anchorTxid: "",
  anchorType: "sale-ticket-v1",
  anchorValueSats: 546,
  anchorVout: 2,
  buyerAddress: "",
  expiresAt: "",
  network: "livenet",
  nonce: "raw-invalid-utf8-generic",
  priceSats: 546,
  registryAddress: WORK_AMO_V5_TOKEN_INDEX_ADDRESS,
  sellerAddress: "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv",
  sellerPublicKey: `02${"11".repeat(32)}`,
  ticker: "EDGE",
  tokenId: hash("4"),
  version: WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION,
};
const rawIdSaleAuthorization = {
  anchorScriptPubKey:
    "76a914111111111111111111111111111111111111111188ac",
  anchorSigHashType: 0x83,
  anchorSignature: "",
  anchorTxid: "",
  anchorType: "sale-ticket-v1",
  anchorValueSats: 546,
  anchorVout: 2,
  buyerAddress: "",
  expiresAt: "",
  id: "alice",
  nonce: "raw-invalid-utf8-id",
  priceSats: 546,
  receiveAddress: "",
  sellerAddress: "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv",
  sellerPublicKey: `02${"11".repeat(32)}`,
  signature: "",
  version: WORK_AMO_V5_ID_SALE_AUTH_VERSION,
};
assert.equal(
  parseWorkAmoV5GenericSaleAuthorization({
    ...rawGenericSaleAuthorization,
    metadata: { label: "東京 🚀" },
    nonce: "雪-🚀-café",
  })?.nonce,
  "雪-🚀-café",
  "Direct generic sale-authorization parsing must preserve valid Unicode.",
);
for (const authorization of [
  { ...rawGenericSaleAuthorization, nonce: "nonce\u0000storage" },
  {
    ...rawGenericSaleAuthorization,
    ignored: { nested: ["safe", "value\u0000storage"] },
  },
  {
    ...rawGenericSaleAuthorization,
    ["ignored\u0000key"]: "value",
  },
]) {
  assert.equal(
    parseWorkAmoV5GenericSaleAuthorization(authorization),
    null,
    "Direct generic sale-authorization objects must recursively reject U+0000.",
  );
}
const rawListingId = hash("a");
const rawBuyerAddress =
  "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const validGenericSaleAuthorization = Buffer.from(
  JSON.stringify(rawGenericSaleAuthorization),
).toString("base64url");
const validIdSaleAuthorization = Buffer.from(
  JSON.stringify(rawIdSaleAuthorization),
).toString("base64url");
assert.equal(
  parseWorkAmoV5RawPwtRecord(
    `pwt1:list5:${validGenericSaleAuthorization}`,
  )?.saleAuthorization?.version,
  WORK_AMO_V5_GENERIC_SALE_AUTH_VERSION,
);
assert.equal(
  parseWorkAmoV5RawPwidRecord(
    `pwid1:list5:${validIdSaleAuthorization}`,
  )?.saleAuthorization?.version,
  WORK_AMO_V5_ID_SALE_AUTH_VERSION,
);
const semanticNulText = "alice\u0000storage";
const semanticNulTextEncoded = Buffer.from(
  semanticNulText,
  "utf8",
).toString("base64url");
const semanticNulPgpEncoded = Buffer.from(
  "-----BEGIN PGP KEY-----\u0000-----END PGP KEY-----",
  "utf8",
).toString("base64url");
for (const message of [
  `pwid1:r:alice\u0000storage:${rawBuyerAddress}:${rawBuyerAddress}`,
  `pwid1:r2:${semanticNulTextEncoded}:${rawBuyerAddress}:${rawBuyerAddress}`,
  `pwid1:r2:${Buffer.from("alice", "utf8").toString("base64url")}:${rawBuyerAddress}:${rawBuyerAddress}:${semanticNulPgpEncoded}`,
  `pwid1:u:${semanticNulTextEncoded}:${rawBuyerAddress}`,
  `pwid1:t:${semanticNulTextEncoded}:${rawBuyerAddress}:${rawBuyerAddress}`,
]) {
  assert.equal(
    parseWorkAmoV5RawPwidRecord(message),
    null,
    "PWID semantic U+0000 must be rejected before raw state mutation.",
  );
}
const semanticNulIdAuthorizations = [
  { ...rawIdSaleAuthorization, id: semanticNulText },
  { ...rawIdSaleAuthorization, nonce: "nonce\u0000storage" },
  {
    ...rawIdSaleAuthorization,
    ignored: { nested: ["safe", "value\u0000storage"] },
  },
  {
    ...rawIdSaleAuthorization,
    ["ignored\u0000key"]: "value",
  },
];
for (const authorization of semanticNulIdAuthorizations) {
  assert.equal(
    parseWorkAmoV5IdSaleAuthorization(authorization),
    null,
    "ID sale authorization objects must recursively reject U+0000.",
  );
  const encoded = Buffer.from(
    JSON.stringify(authorization),
    "utf8",
  ).toString("base64url");
  for (const message of [
    `pwid1:list5:${encoded}`,
    `pwid1:seal5:${rawListingId}:${encoded}`,
  ]) {
    assert.equal(
      parseWorkAmoV5RawPwidRecord(message),
      null,
      "Wire-safe ID authorization JSON must not reintroduce U+0000.",
    );
  }
}
for (const authorization of [
  staticAuthorization,
  rawGenericSaleAuthorization,
]) {
  const invalidUtf8Authorization =
    base64UrlJsonWithInvalidUtf8(authorization);
  for (const message of [
    `pwt1:list5:${invalidUtf8Authorization}`,
    `pwt1:seal5:${rawListingId}:${invalidUtf8Authorization}`,
    `pwt1:buy5:${rawListingId}:${rawBuyerAddress}:${invalidUtf8Authorization}`,
  ]) {
    assert.equal(parseWorkAmoV5RawPwtRecord(message), null);
  }
}
const invalidUtf8IdAuthorization =
  base64UrlJsonWithInvalidUtf8(rawIdSaleAuthorization);
for (const message of [
  `pwid1:list5:${invalidUtf8IdAuthorization}`,
  `pwid1:seal5:${rawListingId}:${invalidUtf8IdAuthorization}`,
]) {
  assert.equal(parseWorkAmoV5RawPwidRecord(message), null);
}

function structurallyInvalidAuthorizationEncodings(source) {
  const prefix = JSON.stringify(source).slice(0, -1);
  return [
    `${prefix},"nonce":"duplicate"}`,
    `${prefix},"nested":{"a":1,"\\u0061":2}}`,
    `${prefix},"ignored":"\\ud800"}`,
    `${prefix},"ignored":"\\udc00"}`,
    `${prefix},"\\ud800":"ignored"}`,
    `${prefix},"\\udc00":"ignored"}`,
    `${prefix},"ignored":"storage\\u0000nul"}`,
    `${prefix},"nested":{"items":["safe","storage\\u0000nul"]}}`,
    `${prefix},"ignored\\u0000key":"value"}`,
  ].map((json) =>
    Buffer.from(json, "utf8").toString("base64url"),
  );
}

function assertRawPwtAuthorizationEncodingRejected(encoded) {
  for (const message of [
    `pwt1:list5:${encoded}`,
    `pwt1:seal5:${rawListingId}:${encoded}`,
    `pwt1:buy5:${rawListingId}:${rawBuyerAddress}:${encoded}`,
  ]) {
    assert.equal(parseWorkAmoV5RawPwtRecord(message), null);
  }
}

function assertRawPwidAuthorizationEncodingRejected(encoded) {
  for (const message of [
    `pwid1:list5:${encoded}`,
    `pwid1:seal5:${rawListingId}:${encoded}`,
  ]) {
    assert.equal(parseWorkAmoV5RawPwidRecord(message), null);
  }
}

for (const source of [
  staticAuthorization,
  rawGenericSaleAuthorization,
]) {
  for (
    const encoded of
      structurallyInvalidAuthorizationEncodings(source)
  ) {
    assertRawPwtAuthorizationEncodingRejected(encoded);
  }
}
for (
  const encoded of structurallyInvalidAuthorizationEncodings(
    rawIdSaleAuthorization,
  )
) {
  assertRawPwidAuthorizationEncodingRejected(encoded);
}

const invalidUtf8Base64Url =
  Buffer.from([0x80]).toString("base64url");
assert.deepEqual(
  parseWorkAmoV5PwmMessages([
    `pwm1:s:${invalidUtf8Base64Url}`,
    "pwm1:m:metadata survives",
  ]),
  {
    contributionField: "mailFlowSats",
    kind: "mail",
    memo: "metadata survives",
  },
);
assert.deepEqual(
  parseWorkAmoV5PwmMessages([
    "pwm1:s:A",
    "pwm1:m:noncanonical metadata ignored",
  ]),
  {
    contributionField: "mailFlowSats",
    kind: "mail",
    memo: "noncanonical metadata ignored",
  },
);
const semanticNulBase64Url = Buffer.from(
  "metadata\u0000storage",
  "utf8",
).toString("base64url");
assert.deepEqual(
  parseWorkAmoV5PwmMessages([
    `pwm1:s:${semanticNulBase64Url}`,
    "pwm1:m:storage-safe metadata survives",
  ]),
  {
    contributionField: "mailFlowSats",
    kind: "mail",
    memo: "storage-safe metadata survives",
  },
);
const rawPwmAttachmentSha256 =
  "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
const rawPwmAttachmentMime =
  Buffer.from("text/plain", "utf8").toString("base64url");
const rawPwmAttachmentName =
  Buffer.from("x.txt", "utf8").toString("base64url");
const rawPwmAttachment = (mime, name, data = "eA") =>
  `pwm1:a:${mime}:${name}:1:${rawPwmAttachmentSha256}:0/1:${data}`;
assert.equal(
  parseWorkAmoV5PwmMessages([
    rawPwmAttachment(
      rawPwmAttachmentMime,
      rawPwmAttachmentName,
    ),
  ])?.attachment?.name,
  "x.txt",
);
for (const malformedAttachment of [
  rawPwmAttachment(
    invalidUtf8Base64Url,
    rawPwmAttachmentName,
  ),
  rawPwmAttachment(
    rawPwmAttachmentMime,
    invalidUtf8Base64Url,
  ),
  rawPwmAttachment(
    semanticNulBase64Url,
    rawPwmAttachmentName,
  ),
  rawPwmAttachment(
    rawPwmAttachmentMime,
    semanticNulBase64Url,
  ),
  rawPwmAttachment(
    rawPwmAttachmentMime,
    rawPwmAttachmentName,
    "A",
  ),
]) {
  assert.equal(
    parseWorkAmoV5PwmMessages([malformedAttachment]),
    null,
  );
}

assert.equal(
  parseWorkAmoV5RawPwtRecord("pwt1:send2:bad:1:bc1qrecipient"),
  null,
);
assert.equal(
  parseWorkAmoV5RawPwtRecord(
    `pwt1:send2:${WORK_TOKEN_ID}:1:bc1qrecipient`,
  ),
  null,
);

assert.throws(
  () =>
    replayWorkAmoV5CanonicalBlock({
      applyTransactionFee: ({ state }) => ({ state }),
      blockHash: sequencerBlockHash,
      blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT + 20,
      evaluateRecord: ({ state }) => ({ state, valid: true }),
      openingState: { n: 0n },
      records: [
        {
          ...sequencerRecords.at(-1),
          transactionProtocolRecordCount: 2,
        },
      ],
      valueFromState: (state) => state.n,
    }),
  (error) => error?.code === "work-amo-v5-sequencer-record-set-incomplete",
);
assert.throws(
  () =>
    replayWorkAmoV5CanonicalBlock({
      applyTransactionFee: ({ state }) => ({ state }),
      blockHash: sequencerBlockHash,
      blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT + 20,
      evaluateRecord: ({ state }) => ({ state, valid: true }),
      openingState: { n: 0n },
      records: [
        {
          ...sequencerRecords.at(-1),
          position: {
            ...sequencerRecords.at(-1).position,
            recordOrdinal: undefined,
          },
        },
      ],
      valueFromState: (state) => state.n,
    }),
  (error) => error?.code === "work-amo-v5-sequencer-position-incomplete",
);
assert.throws(
  () =>
    replayWorkAmoV5CanonicalBlock({
      applyTransactionFee: ({ state }) => ({ state }),
      blockHash: sequencerBlockHash,
      blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
      evaluateRecord: ({ state }) => ({ state, valid: true }),
      openingState: { n: 0n },
      records: [],
      valueFromState: (state) => state.n,
    }),
  (error) => error?.code === "work-amo-v5-sequencer-input-invalid",
);
for (const decreasingStep of ["record", "fee"]) {
  assert.throws(
    () =>
      replayWorkAmoV5CanonicalBlock({
        applyTransactionFee: ({ state }) => ({
          state: {
            n: decreasingStep === "fee" ? state.n - 1n : state.n,
          },
        }),
        blockHash: sequencerBlockHash,
        blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT + 20,
        evaluateRecord: ({ state }) => ({
          state: {
            n: decreasingStep === "record" ? state.n - 1n : state.n,
          },
          valid: true,
        }),
        openingState: { n: 10n },
        records: [
          {
            ...sequencerRecords.at(-1),
            transactionProtocolRecordCount: 1,
          },
        ],
        valueFromState: (state) => state.n,
      }),
    (error) => error?.code === "work-amo-v5-sequencer-negative-bond",
  );
}
const tokenStateCommitment = workAmoV5CanonicalPayloadCommitment({
  balances: { seller: "2" },
  listings: [{ listingId: hash("f"), reservedAtoms: "1" }],
});
const genericTokenStateCommitment = workAmoV5CanonicalPayloadCommitment({
  definitions: [],
  holders: [],
  listings: [],
  supply: [],
});
const idStateCommitment = workAmoV5CanonicalPayloadCommitment({
  listings: [],
  records: [],
});
const canonicalTokenState = {
  confirmedSupplyAtoms: "2",
  holders: [{ address: "seller", balanceAtoms: "2" }],
  listings: [],
};
assert.equal(
  workAmoV5CanonicalTokenStatePreimage(canonicalTokenState).model,
  WORK_AMO_V5_TOKEN_STATE_PREIMAGE_MODEL,
);
assert.equal(
  /^[0-9a-f]{64}$/u.test(
    workAmoV5CanonicalTokenStateCommitment(canonicalTokenState).sha256,
  ),
  true,
);
const historicalV4TokenState = {
  confirmedSupplyAtoms: historicalV4Authorization.amountAtoms,
  holders: [
    {
      address: historicalV4Authorization.sellerAddress,
      balanceAtoms: historicalV4Authorization.amountAtoms,
    },
  ],
  listings: [
    {
      amountAtoms: historicalV4Authorization.amountAtoms,
      frozenTerms: historicalV4FrozenTerms,
      listingId: hash("4"),
      priceSats: historicalV4Authorization.priceSats,
      saleAuthorization: historicalV4Authorization,
      sellerAddress: historicalV4Authorization.sellerAddress,
    },
  ],
};
const historicalV4Commitment =
  workAmoV5CanonicalTokenStateCommitment(historicalV4TokenState);
assert.equal(
  workAmoV5CanonicalTokenStateCommitment({
    ...structuredClone(historicalV4TokenState),
    listings: historicalV4TokenState.listings.map((listing) => ({
      ...structuredClone(listing),
      frozenTerms: {
        ...structuredClone(listing.frozenTerms),
        mutableProjectionDecoration: "ignored",
      },
      saleAuthorization: {
        ...structuredClone(listing.saleAuthorization),
        mutableProjectionDecoration: "ignored",
      },
    })),
  }).sha256,
  historicalV4Commitment.sha256,
);
assert.throws(
  () =>
    workAmoV5CanonicalTokenStateCommitment({
      ...structuredClone(historicalV4TokenState),
      listings: historicalV4TokenState.listings.map((listing) => ({
        ...structuredClone(listing),
        saleAuthorization: {
          ...structuredClone(listing.saleAuthorization),
          priceSats: (
            BigInt(listing.saleAuthorization.priceSats) + 1n
          ).toString(),
        },
      })),
    }),
  /work-amo-v5-token-state-listing-invalid/u,
);
assert.equal(
  tokenStateCommitment.model,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
);
assert.notEqual(
  workAmoV5CanonicalPayloadCommitment({ value: 1n }).sha256,
  workAmoV5CanonicalPayloadCommitment({ value: "1" }).sha256,
);
const rawUtf8AstralKey = "\u{10000}";
const rawUtf8BmpKey = "\ue000";
assert.deepEqual(
  [rawUtf8AstralKey, rawUtf8BmpKey].sort(),
  [rawUtf8AstralKey, rawUtf8BmpKey],
);
assert.deepEqual(
  [rawUtf8AstralKey, rawUtf8BmpKey].sort(compareWorkAmoUtf8),
  [rawUtf8BmpKey, rawUtf8AstralKey],
);
const rawUtf8KeyCommitment =
  workAmoV5CanonicalPayloadCommitment({
    [rawUtf8AstralKey]: "astral",
    [rawUtf8BmpKey]: "bmp",
  });
assert.deepEqual(
  rawUtf8KeyCommitment,
  workAmoV5CanonicalPayloadCommitment({
    [rawUtf8BmpKey]: "bmp",
    [rawUtf8AstralKey]: "astral",
  }),
);
const rawUtf8OrderedPayload = JSON.stringify({
  model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  value: {
    [rawUtf8BmpKey]: "bmp",
    [rawUtf8AstralKey]: "astral",
  },
});
assert.deepEqual(rawUtf8KeyCommitment, {
  model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  payloadBytes: Buffer.byteLength(rawUtf8OrderedPayload),
  sha256: createHash("sha256")
    .update(rawUtf8OrderedPayload)
    .digest("hex"),
});
const rawOwnProtoPayload = JSON.parse(
  '{"__proto__":{"x":1},"safe":2}',
);
assert.equal(
  Object.hasOwn(rawOwnProtoPayload, "__proto__"),
  true,
);
assert.notDeepEqual(
  workAmoV5CanonicalPayloadCommitment(rawOwnProtoPayload),
  workAmoV5CanonicalPayloadCommitment({ safe: 2 }),
);
assert.deepEqual(
  workAmoV5CanonicalPayloadCommitment(rawOwnProtoPayload),
  workAmoV5CanonicalPayloadCommitment(
    JSON.parse('{"safe":2,"__proto__":{"x":1}}'),
  ),
);
assert.throws(
  () => {
    const sparse = [];
    sparse.length = 1;
    return workAmoV5CanonicalPayloadCommitment(sparse);
  },
  /sparse or decorated array/u,
);
for (const unsupportedCanonicalObject of [
  new Date(0),
  new Map([["safe", 2]]),
]) {
  assert.throws(
    () =>
      workAmoV5CanonicalPayloadCommitment(
        unsupportedCanonicalObject,
      ),
    /unsupported object/u,
  );
}
let rawCanonicalArrayGetterCalled = false;
const rawCanonicalAccessorArray = [];
Object.defineProperty(rawCanonicalAccessorArray, "0", {
  enumerable: true,
  get() {
    rawCanonicalArrayGetterCalled = true;
    return 1;
  },
});
rawCanonicalAccessorArray.length = 1;
assert.throws(
  () =>
    workAmoV5CanonicalPayloadCommitment(
      rawCanonicalAccessorArray,
    ),
  /sparse or decorated array/u,
);
assert.equal(rawCanonicalArrayGetterCalled, false);
const rawCanonicalNonEnumerableArray = [1];
Object.defineProperty(rawCanonicalNonEnumerableArray, "hidden", {
  value: 2,
});
assert.throws(
  () =>
    workAmoV5CanonicalPayloadCommitment(
      rawCanonicalNonEnumerableArray,
    ),
  /sparse or decorated array/u,
);
const rawCanonicalCustomPrototypeArray = [1];
Object.setPrototypeOf(
  rawCanonicalCustomPrototypeArray,
  Object.create(Array.prototype),
);
assert.throws(
  () =>
    workAmoV5CanonicalPayloadCommitment(
      rawCanonicalCustomPrototypeArray,
    ),
  /sparse or decorated array/u,
);
assert.throws(
  () =>
    workAmoV5CanonicalPayloadCommitment({
      absentCollision: undefined,
    }),
  /unsupported value/u,
);
assert.throws(
  () => workAmoV5CanonicalPayloadCommitment({ value: -0 }),
  /non-integer number/u,
);
assert.match(
  workAmoV5CanonicalPayloadCommitment({ value: 0 }).sha256,
  /^[0-9a-f]{64}$/u,
);
const sufficientStateA = {
  baseState: Object.fromEntries(
    WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [field, "0"]),
  ),
  creditFixedQ8: "1",
  creditMovementFrozenValueQ8: "2",
  genericTokenStateCommitment,
  idStateCommitment,
  model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  movements: [{ amountAtoms: "3", identity: "mint:fixture" }],
  network: "livenet",
  networkValueQ8: "1",
  quoteHead: selectedChain.head,
  throughBlockHash: hash("f"),
  throughBlockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
  tokenStateCommitment,
};
const sufficientStateB = {
  ...structuredClone(sufficientStateA),
  baseState: Object.fromEntries(
    [...Object.entries(sufficientStateA.baseState)].reverse(),
  ),
};
const sufficientStateCommitment =
  workAmoV5CanonicalStateCommitment(sufficientStateA);
assert.equal(
  sufficientStateCommitment.model,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
);
assert.equal(validateWorkAmoV5SufficientState(sufficientStateA).valid, true);
assert.equal(
  workAmoV5NetworkValueQ8FromSufficientState(sufficientStateA)
    .networkValueQ8,
  "1",
);
assert.equal(
  /^[0-9a-f]{64}$/u.test(sufficientStateCommitment.sha256),
  true,
);
assert.equal(
  workAmoV5CanonicalStatesMatch(sufficientStateA, sufficientStateB),
  true,
);
assert.equal(
  workAmoV5CanonicalStatesMatch(
    sufficientStateA,
    { ...sufficientStateB, networkValueQ8: "5" },
  ),
  false,
);
assert.equal(
  validateWorkAmoV5SufficientState({
    ...sufficientStateA,
    baseState: { ...sufficientStateA.baseState, unexpected: "0" },
  }).reasonCode,
  "work-amo-v5-sufficient-state-base-invalid",
);
for (const commitmentField of [
  "genericTokenStateCommitment",
  "idStateCommitment",
]) {
  const incompleteState = structuredClone(sufficientStateA);
  delete incompleteState[commitmentField];
  assert.equal(
    validateWorkAmoV5SufficientState(incompleteState).reasonCode,
    "work-amo-v5-sufficient-state-binding-invalid",
  );
}
assert.equal(
  workAmoV5CanonicalStatesMatch(sufficientStateA, {
    ...sufficientStateA,
    idStateCommitment: {
      ...sufficientStateA.idStateCommitment,
      sha256: hash("0"),
    },
  }),
  false,
);
const eventSetCommitment = workAmoV5EventSetCommitment([
  {
    feeSats: "11",
    kind: "token-listing",
    payload: { face: 20 },
    position: canonicalPosition(
      WORK_AMO_V5_ACTIVATION_HEIGHT,
      2,
      3,
      0,
    ),
    protocol: "pwt1",
    reasonCode: "",
    txid: hash("1"),
    valid: true,
  },
  {
    feeSats: "7",
    kind: "usd-quote",
    payload: { sequence: "1" },
    position: canonicalPosition(
      WORK_AMO_V5_ACTIVATION_HEIGHT,
      1,
      2,
      0,
    ),
    protocol: "pwa1",
    reasonCode: "",
    txid: hash("2"),
    valid: true,
  },
]);
assert.equal(
  eventSetCommitment.model,
  WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
);
assert.equal(eventSetCommitment.eventCount, 2);
assert.equal(
  eventSetCommitment.sha256,
  workAmoV5EventSetCommitment([
    {
      feeSats: "7",
      kind: "usd-quote",
      payload: { sequence: "1" },
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT,
        1,
        2,
        0,
      ),
      protocol: "pwa1",
      reasonCode: "",
      txid: hash("2"),
      valid: true,
    },
    {
      feeSats: "11",
      kind: "token-listing",
      payload: { face: 20 },
      position: canonicalPosition(
        WORK_AMO_V5_ACTIVATION_HEIGHT,
        2,
        3,
        0,
      ),
      protocol: "pwt1",
      reasonCode: "",
      txid: hash("1"),
      valid: true,
    },
  ]).sha256,
);

const mixedProtocols = ["pwm1", "pwa1", "pwid1", "pwt1"];
const mixedProtocolEvents = mixedProtocols.map((protocol, index) => ({
  feeSats: String(index + 1),
  kind: `display-label-${index}`,
  payload: {
    model: "canonical-raw-protocol-record-v1",
    rawRecordParts: [
      {
        protocolVout: index + 1,
        scriptPubKeyHex: `6a01${index.toString(16).padStart(2, "0")}`,
        text: `${protocol}:fixture`,
      },
    ],
  },
  position: canonicalPosition(
    WORK_AMO_V5_ACTIVATION_HEIGHT + 3,
    index,
    index + 1,
    0,
    hash("c"),
  ),
  protocol,
  reasonCode: index === 3 ? "fixture-invalid" : "",
  stateDelta:
    index === 3
      ? {
          baseContributions: [],
          creditFixedQ8: "0",
          creditFixedSats: "0",
        }
      : {
          baseContributions: [
            { field: "computerEventFlowSats", value: String(index + 1) },
          ],
          creditFixedQ8: "0",
          creditFixedSats: "0",
        },
  txid: (index + 10).toString(16).padStart(64, "0"),
  valid: index !== 3,
}));
const mixedCommitment =
  workAmoV5EventSetCommitment(mixedProtocolEvents);
assert.deepEqual(
  mixedProtocols.map((protocol, index) =>
    workAmoV5ConsensusEventKind(protocol, index !== 3),
  ),
  [
    "pwm1-valid",
    "pwa1-valid",
    "pwid1-valid",
    "pwt1-invalid",
  ],
);
assert.equal(
  mixedCommitment.sha256,
  workAmoV5EventSetCommitment(
    mixedProtocolEvents.map((event) => ({
      ...event,
      kind: `different-ui-kind-${event.protocol}`,
    })),
  ).sha256,
);
assert.notEqual(
  mixedCommitment.sha256,
  workAmoV5EventSetCommitment(
    mixedProtocolEvents.map((event, index) =>
      index === 0
        ? {
            ...event,
            payload: {
              ...event.payload,
              rawRecordParts: event.payload.rawRecordParts.map((part) => ({
                ...part,
                scriptPubKeyHex: `${part.scriptPubKeyHex}00`,
              })),
            },
          }
        : event,
    ),
  ).sha256,
);

function buildRawAdversarialOpeningEconomicState({
  genericState,
  idState,
  priorBlockHash,
  priorBlockHeight,
  workState,
}) {
  const computerEventFlowSats = 4_200_000n;
  return {
    baseState: Object.fromEntries(
      WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [
        field,
        field === "computerEventFlowSats"
          ? computerEventFlowSats.toString()
          : "0",
      ]),
    ),
    creditFixedQ8: "0",
    creditMovementFrozenValueQ8: "0",
    genericTokenStateCommitment:
      workAmoV5RawGenericStateCommitment(genericState),
    idStateCommitment: workAmoV5RawIdStateCommitment(idState),
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
    movements: [],
    network: "livenet",
    networkValueQ8: (
      computerEventFlowSats * 5n * 100_000_000n
    ).toString(),
    quoteHead: null,
    throughBlockHash: priorBlockHash,
    throughBlockHeight: priorBlockHeight,
    tokenStateCommitment:
      workState.amountStorageModel ===
        WORK_SUBATOM_PROJECTION_MODEL
        ? workAmoV8CanonicalTokenStateCommitment(workState)
        : workAmoV5CanonicalTokenStateCommitment(workState),
  };
}

function rawAdversarialOpReturnScript(message) {
  const payload = Buffer.from(message, "utf8");
  assert.ok(payload.length <= 65_535);
  const push =
    payload.length <= 75
      ? payload.length.toString(16).padStart(2, "0")
      : payload.length <= 255
        ? `4c${payload.length.toString(16).padStart(2, "0")}`
        : `4d${Buffer.from([
            payload.length & 0xff,
            payload.length >> 8,
          ]).toString("hex")}`;
  return `6a${push}${payload.toString("hex")}`;
}

function rawAdversarialHydratedTransaction({
  feeSats,
  tx,
}) {
  const hydrated = structuredClone(tx);
  hydrated.vout = hydrated.vout.map((output) => {
    const normalized = structuredClone(output);
    if (
      !normalized.scriptpubkey &&
      normalized.scriptpubkey_address
    ) {
      normalized.scriptpubkey = Buffer.from(
        bitcoin.address.toOutputScript(
          normalized.scriptpubkey_address,
          bitcoin.networks.bitcoin,
        ),
      ).toString("hex");
    }
    return normalized;
  });
  if (!Array.isArray(hydrated.vin) || hydrated.vin.length === 0) {
    hydrated.vin = [
      {
        prevout: {
          scriptpubkey_address:
            "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv",
        },
        txid: hash("f"),
        vout: 0,
      },
    ];
  }
  const outputSats = hydrated.vout.reduce(
    (total, output) => total + BigInt(output.value),
    0n,
  );
  hydrated.vin = hydrated.vin.map((input, index) => ({
    ...input,
    prevout: (() => {
      const prevout = {
        ...(input.prevout ?? {}),
        value:
          index === 0
            ? (
                outputSats + BigInt(feeSats)
              ).toString()
            : "0",
      };
      prevout.scriptpubkey_address ??=
        "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
      prevout.scriptpubkey ??= Buffer.from(
        bitcoin.address.toOutputScript(
          prevout.scriptpubkey_address,
          bitcoin.networks.bitcoin,
        ),
      ).toString("hex");
      return prevout;
    })(),
  }));
  const serialized = new bitcoin.Transaction();
  serialized.version = hydrated.version ?? 2;
  serialized.locktime = hydrated.locktime ?? 0;
  for (const input of hydrated.vin) {
    const inputIndex = serialized.ins.length;
    if (typeof input.coinbase === "string") {
      serialized.addInput(
        Buffer.alloc(32),
        0xffffffff,
        input.sequence ?? 0xffffffff,
        Buffer.from(input.coinbase, "hex"),
      );
    } else {
      serialized.addInput(
        Buffer.from(input.txid, "hex").reverse(),
        input.vout,
        input.sequence ?? 0xffffffff,
        Buffer.from(input.scriptsig ?? "", "hex"),
      );
    }
    if (Array.isArray(input.txinwitness)) {
      serialized.setWitness(
        inputIndex,
        input.txinwitness.map((item) =>
          Buffer.from(item, "hex")
        ),
      );
    }
  }
  for (const output of hydrated.vout) {
    serialized.addOutput(
      Buffer.from(output.scriptpubkey, "hex"),
      BigInt(output.value),
    );
  }
  hydrated.hex = serialized.toHex();
  hydrated.txid = serialized.getId();
  return hydrated;
}

function rawAdversarialRecord({
  blockHash,
  blockHeight,
  blockTransactionIndex,
  feeSats,
  message,
  protocol,
  protocolVout,
  transactionProtocolRecordCount,
  tx,
  txid,
}) {
  const hydratedTx = rawAdversarialHydratedTransaction({
    feeSats,
    tx,
  });
  if (txid !== undefined) {
    assert.equal(hydratedTx.txid, txid);
  }
  const reconstruction =
    canonicalRawProtocolRecordSetFromTransaction(hydratedTx);
  const canonical = reconstruction.records.find(
    (record) =>
      record.protocolVout === protocolVout &&
      record.recordOrdinal === 0,
  );
  assert.ok(canonical);
  if (message !== undefined) {
    assert.equal(canonical.message, message);
  }
  if (protocol !== undefined) {
    assert.equal(canonical.protocol, protocol);
  }
  const rawRecordParts = structuredClone(
    canonical.rawRecordParts,
  );
  return {
    message: canonical.message,
    payload: structuredClone(canonical.payload),
    position: {
      blockHash,
      blockHeight,
      blockTransactionIndex,
      protocolVout: canonical.protocolVout,
      recordOrdinal: canonical.recordOrdinal,
    },
    protocol: canonical.protocol,
    protocolVout: canonical.protocolVout,
    rawDecodeReasonCode: canonical.rawDecodeReasonCode,
    rawDecodeValid: canonical.rawDecodeValid,
    rawPayloadHex: rawRecordParts
      .map((part) => part.payloadHex)
      .join(""),
    rawRecordParts,
    rawScriptPubKeyHex:
      rawRecordParts[0]?.scriptPubKeyHex ?? "",
    recordOrdinal: canonical.recordOrdinal,
    transactionMinerFeeSats: String(feeSats),
    transactionProtocolRecordCount:
      transactionProtocolRecordCount ??
      reconstruction.records.length,
    tx: hydratedTx,
    txid: hydratedTx.txid,
  };
}

const rawAdversarialBlockHeight =
  WORK_AMO_V5_ACTIVATION_HEIGHT + 40;
const rawAdversarialBlockHash = hash("c");
const rawAdversarialPriorBlockHash = hash("b");
const rawAdversarialActor =
  "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const rawAdversarialRecipient =
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS;
const rawAdversarialGenericTokenId = hash("4");
const rawAdversarialGenericRegistry =
  WORK_AMO_V5_TOKEN_INDEX_ADDRESS;
const rawAdversarialOpeningGenericState =
  normalizeWorkAmoV5RawGenericState({
    holders: [],
    listings: [],
    tokens: [
      {
        confirmedSupply: "0",
        maxSupply: "10",
        mintAmount: "1",
        mintPriceSats: "546",
        registryAddress: rawAdversarialGenericRegistry,
        ticker: "EDGE",
        tokenId: rawAdversarialGenericTokenId,
      },
      {
        confirmedSupply: "0",
        maxSupply: null,
        mintAmount: "1",
        mintPriceSats: "1",
        registryAddress: rawAdversarialGenericRegistry,
        ticker: "POWB",
        tokenId: WORK_AMO_V5_POWB_TOKEN_ID,
      },
      {
        confirmedSupply: "0",
        maxSupply: null,
        mintAmount: "1",
        mintPriceSats: "1",
        registryAddress: rawAdversarialGenericRegistry,
        ticker: "INCB",
        tokenId: WORK_AMO_V5_INCB_TOKEN_ID,
      },
    ],
  });
const rawAdversarialOpeningIdState =
  normalizeWorkAmoV5RawIdState({
    listings: [],
    records: [
      {
        id: "alice",
        ownerAddress: rawAdversarialActor,
        receiveAddress: rawAdversarialActor,
      },
      {
        id: "bob",
        ownerAddress: WORK_AMO_V5_ID_REGISTRY_ADDRESS,
        receiveAddress: WORK_AMO_V5_ID_REGISTRY_ADDRESS,
      },
    ],
  });
const rawAdversarialOpeningWorkState =
  normalizeWorkAmoV5RawWorkState({
    confirmedSupplyAtoms: "10",
    holders: [
      {
        address: rawAdversarialActor,
        balanceAtoms: "10",
      },
    ],
    listings: [],
  });
const rawAdversarialOpeningEconomicState =
  buildRawAdversarialOpeningEconomicState({
    genericState: rawAdversarialOpeningGenericState,
    idState: rawAdversarialOpeningIdState,
    priorBlockHash: rawAdversarialPriorBlockHash,
    priorBlockHeight: rawAdversarialBlockHeight - 1,
    workState: rawAdversarialOpeningWorkState,
  });

let rawAdversarialWorkTxid = "";
const rawAdversarialInvalidWorkMessage =
  `pwt1:mint:${WORK_TOKEN_ID}:1`;
const rawAdversarialValidWorkMessage =
  `pwt1:send2:${WORK_TOKEN_ID}:1:${rawAdversarialRecipient}`;
const rawAdversarialWorkTx = {
  vin: [
    {
      prevout: {
        scriptpubkey_address: rawAdversarialActor,
      },
      txid: hash("a"),
      vout: 0,
    },
  ],
  vout: [
    {
      scriptpubkey_address:
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      value: 1_000,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialInvalidWorkMessage,
        ),
      value: 0,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialValidWorkMessage,
        ),
      value: 0,
    },
  ],
};
rawAdversarialWorkTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 11,
    tx: rawAdversarialWorkTx,
  }).txid;

let rawAdversarialGenericTxid = "";
const rawAdversarialInvalidGenericMessage =
  `pwt1:mint:${WORK_AMO_V5_POWB_TOKEN_ID}:1`;
const rawAdversarialValidGenericMessage =
  `pwt1:mint:${rawAdversarialGenericTokenId}:1`;
const rawAdversarialGenericTx = {
  vin: [
    {
      prevout: {
        scriptpubkey_address: rawAdversarialActor,
      },
      txid: hash("9"),
      vout: 0,
    },
  ],
  vout: [
    {
      scriptpubkey_address: rawAdversarialGenericRegistry,
      value: 546,
    },
    {
      scriptpubkey_address: rawAdversarialActor,
      value: 9,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialInvalidGenericMessage,
        ),
      value: 0,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialValidGenericMessage,
        ),
      value: 0,
    },
  ],
};
rawAdversarialGenericTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 13,
    tx: rawAdversarialGenericTx,
  }).txid;

let rawAdversarialIdTxid = "";
const rawAdversarialInvalidIdMessage =
  `pwid1:u:${Buffer.from("bob", "utf8").toString("base64url")}:` +
  rawAdversarialRecipient;
const rawAdversarialValidIdMessage =
  `pwid1:u:${Buffer.from("alice", "utf8").toString("base64url")}:` +
  rawAdversarialRecipient;
const rawAdversarialIdTx = {
  vin: [
    {
      prevout: {
        scriptpubkey_address: rawAdversarialActor,
      },
      txid: hash("8"),
      vout: 0,
    },
  ],
  vout: [
    {
      scriptpubkey_address: WORK_AMO_V5_ID_REGISTRY_ADDRESS,
      value: 546,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialInvalidIdMessage,
        ),
      value: 0,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialValidIdMessage,
        ),
      value: 0,
    },
  ],
};
rawAdversarialIdTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 17,
    tx: rawAdversarialIdTx,
  }).txid;

let rawAdversarialDerivedTxid = "";
const rawAdversarialDerivedMessage = "pwm1:m:powb";
const rawAdversarialDerivedTx = {
  vin: [
    {
      prevout: {
        scriptpubkey_address: rawAdversarialActor,
      },
      txid: hash("7"),
      vout: 0,
    },
  ],
  vout: [
    {
      scriptpubkey_address: rawAdversarialActor,
      value: 77,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialDerivedMessage,
        ),
      value: 0,
    },
  ],
};
rawAdversarialDerivedTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 19,
    tx: rawAdversarialDerivedTx,
  }).txid;

let rawAdversarialInvalidOnlyATxid = "";
const rawAdversarialInvalidOnlyAMessage = "pwt1:invalid";
const rawAdversarialInvalidOnlyATx = {
  vin: [],
  vout: [
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialInvalidOnlyAMessage,
        ),
      value: 0,
    },
  ],
};
rawAdversarialInvalidOnlyATxid =
  rawAdversarialHydratedTransaction({
    feeSats: 23,
    tx: rawAdversarialInvalidOnlyATx,
  }).txid;
let rawAdversarialInvalidOnlyBTxid = "";
const rawAdversarialInvalidOnlyBMessage = "pwid1:invalid";
const rawAdversarialInvalidOnlyBTx = {
  vin: [],
  vout: [
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(
          rawAdversarialInvalidOnlyBMessage,
        ),
      value: 0,
    },
  ],
};
rawAdversarialInvalidOnlyBTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 29,
    tx: rawAdversarialInvalidOnlyBTx,
  }).txid;

const rawAdversarialRecords = [
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 1,
    feeSats: 11,
    message: rawAdversarialInvalidWorkMessage,
    protocol: "pwt1",
    protocolVout: 1,
    transactionProtocolRecordCount: 2,
    tx: rawAdversarialWorkTx,
    txid: rawAdversarialWorkTxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 1,
    feeSats: 11,
    message: rawAdversarialValidWorkMessage,
    protocol: "pwt1",
    protocolVout: 2,
    transactionProtocolRecordCount: 2,
    tx: rawAdversarialWorkTx,
    txid: rawAdversarialWorkTxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 2,
    feeSats: 13,
    message: rawAdversarialInvalidGenericMessage,
    protocol: "pwt1",
    protocolVout: 2,
    transactionProtocolRecordCount: 2,
    tx: rawAdversarialGenericTx,
    txid: rawAdversarialGenericTxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 2,
    feeSats: 13,
    message: rawAdversarialValidGenericMessage,
    protocol: "pwt1",
    protocolVout: 3,
    transactionProtocolRecordCount: 2,
    tx: rawAdversarialGenericTx,
    txid: rawAdversarialGenericTxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 3,
    feeSats: 17,
    message: rawAdversarialInvalidIdMessage,
    protocol: "pwid1",
    protocolVout: 1,
    transactionProtocolRecordCount: 2,
    tx: rawAdversarialIdTx,
    txid: rawAdversarialIdTxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 3,
    feeSats: 17,
    message: rawAdversarialValidIdMessage,
    protocol: "pwid1",
    protocolVout: 2,
    transactionProtocolRecordCount: 2,
    tx: rawAdversarialIdTx,
    txid: rawAdversarialIdTxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 4,
    feeSats: 19,
    message: rawAdversarialDerivedMessage,
    protocol: "pwm1",
    protocolVout: 1,
    tx: rawAdversarialDerivedTx,
    txid: rawAdversarialDerivedTxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 5,
    feeSats: 23,
    message: rawAdversarialInvalidOnlyAMessage,
    protocol: "pwt1",
    protocolVout: 0,
    tx: rawAdversarialInvalidOnlyATx,
    txid: rawAdversarialInvalidOnlyATxid,
  }),
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 6,
    feeSats: 29,
    message: rawAdversarialInvalidOnlyBMessage,
    protocol: "pwid1",
    protocolVout: 0,
    tx: rawAdversarialInvalidOnlyBTx,
    txid: rawAdversarialInvalidOnlyBTxid,
  }),
];

function rawAdversarialCoinbaseTransaction(
  unique = 0,
  {
    commitmentScriptPubKey,
    commitmentScriptPubKeys = [],
    witnessReservedValue,
  } = {},
) {
  const marker = Number(unique)
    .toString(16)
    .padStart(8, "0");
  return rawAdversarialHydratedTransaction({
    feeSats: 0,
    tx: {
      vin: [
        {
          coinbase: `04${marker}`,
          ...(witnessReservedValue
            ? { txinwitness: [witnessReservedValue] }
            : {}),
        },
      ],
      vout: [
        {
          scriptpubkey: "51",
          value: 0,
        },
        ...[
          ...(commitmentScriptPubKey
            ? [commitmentScriptPubKey]
            : []),
          ...commitmentScriptPubKeys,
        ].map((scriptpubkey) => ({
          scriptpubkey,
          value: 0,
        })),
      ],
    },
  });
}

function rawAdversarialNeutralTransaction(blockTransactionIndex) {
  return rawAdversarialHydratedTransaction({
    feeSats: 0,
    tx: {
      vin: [
        {
          txid: (20_000 + blockTransactionIndex)
            .toString(16)
            .padStart(64, "0"),
          vout: 0,
        },
      ],
      vout: [
        {
          scriptpubkey: "6a00",
          value: 0,
        },
      ],
    },
  });
}

function rawAdversarialBlockTransactions(records) {
  const maximumBlockTransactionIndex = Math.max(
    0,
    ...records.map(
      (record) => record.position.blockTransactionIndex,
    ),
  );
  const transactions = Array.from(
    { length: maximumBlockTransactionIndex + 1 },
    (_, blockTransactionIndex) =>
      blockTransactionIndex === 0
        ? rawAdversarialCoinbaseTransaction(0)
        : rawAdversarialNeutralTransaction(
            blockTransactionIndex,
          ),
  );
  const occupiedIndexes = new Map();
  for (const record of records) {
    const blockTransactionIndex =
      record.position.blockTransactionIndex;
    if (occupiedIndexes.has(blockTransactionIndex)) {
      assert.equal(
        occupiedIndexes.get(blockTransactionIndex),
        record.txid,
      );
      continue;
    }
    occupiedIndexes.set(blockTransactionIndex, record.txid);
    transactions[blockTransactionIndex] =
      structuredClone(record.tx);
  }
  return transactions.map(
    (transaction, blockTransactionIndex) => ({
      ...transaction,
      _powBlockIndex: blockTransactionIndex,
    }),
  );
}

function rawAdversarialDoubleSha256(bytes) {
  return createHash("sha256")
    .update(createHash("sha256").update(bytes).digest())
    .digest();
}

function rawAdversarialMerkleRoot(txids) {
  let level = txids.map((txid) =>
    Buffer.from(txid, "hex").reverse()
  );
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(Buffer.from(level.at(-1)));
    }
    level = Array.from(
      { length: level.length / 2 },
      (_, index) =>
        rawAdversarialDoubleSha256(
          Buffer.concat([
            level[index * 2],
            level[index * 2 + 1],
          ]),
        ),
    );
  }
  return Buffer.from(level[0]).reverse().toString("hex");
}

function rawAdversarialWitnessMerkleRoot(blockTransactions) {
  let level = blockTransactions.map((transaction, index) =>
    index === 0
      ? Buffer.alloc(32)
      : Buffer.from(
          bitcoin.Transaction.fromHex(
            transaction.hex,
          ).getHash(true),
        )
  );
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(Buffer.from(level.at(-1)));
    }
    level = Array.from(
      { length: level.length / 2 },
      (_, index) =>
        rawAdversarialDoubleSha256(
          Buffer.concat([
            level[index * 2],
            level[index * 2 + 1],
          ]),
        ),
    );
  }
  return level[0];
}

function rawAdversarialWitnessCommitmentScript(
  blockTransactions,
  witnessReservedValue,
) {
  const commitment = rawAdversarialDoubleSha256(
    Buffer.concat([
      rawAdversarialWitnessMerkleRoot(blockTransactions),
      Buffer.from(witnessReservedValue, "hex"),
    ]),
  ).toString("hex");
  return `6a24aa21a9ed${commitment}`;
}

function rawAdversarialBlockHeader(
  blockTransactions,
  { blockTimeSeconds = 1_700_000_000 } = {},
) {
  const merkleRoot = rawAdversarialMerkleRoot(
    blockTransactions.map(({ txid }) => txid),
  );
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(rawAdversarialPriorBlockHash, "hex")
    .reverse()
    .copy(header, 4);
  Buffer.from(merkleRoot, "hex")
    .reverse()
    .copy(header, 36);
  header.writeUInt32LE(blockTimeSeconds, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  header.writeUInt32LE(0, 76);
  return {
    blockHash: Buffer.from(
      rawAdversarialDoubleSha256(header),
    ).reverse().toString("hex"),
    blockHeaderHex: header.toString("hex"),
  };
}

function rawAdversarialBlockContext(
  records,
  blockTransactions =
    rawAdversarialBlockTransactions(records),
  options,
) {
  const header = rawAdversarialBlockHeader(
    blockTransactions,
    options,
  );
  return {
    ...header,
    blockTransactions,
    records: structuredClone(records).map((record) => ({
      ...record,
      position: {
        ...record.position,
        blockHash: header.blockHash,
      },
    })),
  };
}

function replayRawAdversarialContext(
  context,
  {
    openingEconomicState =
      rawAdversarialOpeningEconomicState,
    openingGenericState =
      rawAdversarialOpeningGenericState,
    openingIdState = rawAdversarialOpeningIdState,
    openingWorkState = rawAdversarialOpeningWorkState,
    workAmoV8 = null,
  } = {},
) {
  return replayWorkAmoV5RawBlock({
    blockHeaderHex: context.blockHeaderHex,
    blockTransactions: context.blockTransactions,
    expectedBlockHash: context.blockHash,
    expectedBlockHeight: rawAdversarialBlockHeight,
    expectedPreviousBlockHash: rawAdversarialPriorBlockHash,
    openingEconomicState,
    openingGenericState,
    openingIdState,
    openingWorkState,
    records: context.records,
    workAmoV8,
  });
}

function replayRawAdversarialRecords(
  records,
  blockTransactions =
    rawAdversarialBlockTransactions(records),
) {
  const context = rawAdversarialBlockContext(
    records,
    blockTransactions,
  );
  return replayRawAdversarialContext(context);
}

function assertRawAdversarialClosingRootsEqual(left, right) {
  assert.deepEqual(left.stateCommitment, right.stateCommitment);
  assert.deepEqual(
    left.genericTokenStateCommitment,
    right.genericTokenStateCommitment,
  );
  assert.deepEqual(left.idStateCommitment, right.idStateCommitment);
  assert.deepEqual(
    left.tokenStateCommitment,
    right.tokenStateCommitment,
  );
}

function assertRawAdversarialLogicalStateEqual(left, right) {
  assert.deepEqual(
    left.genericTokenStateCommitment,
    right.genericTokenStateCommitment,
  );
  assert.deepEqual(left.idStateCommitment, right.idStateCommitment);
  assert.deepEqual(
    left.tokenStateCommitment,
    right.tokenStateCommitment,
  );
  const {
    throughBlockHash: _leftThroughBlockHash,
    ...leftEconomicState
  } = left.economicState;
  const {
    throughBlockHash: _rightThroughBlockHash,
    ...rightEconomicState
  } = right.economicState;
  const withoutMovementIdentity = (state) => ({
    ...state,
    movements: state.movements.map(
      ({ identity: _identity, ...movement }) => movement,
    ),
  });
  assert.deepEqual(
    withoutMovementIdentity(leftEconomicState),
    withoutMovementIdentity(rightEconomicState),
  );
}

const rawAdversarialOpeningWitness = {
  economic: structuredClone(
    rawAdversarialOpeningEconomicState,
  ),
  generic: structuredClone(
    rawAdversarialOpeningGenericState,
  ),
  id: structuredClone(rawAdversarialOpeningIdState),
  work: structuredClone(rawAdversarialOpeningWorkState),
};
const rawAdversarialFullBlock =
  rawAdversarialBlockTransactions(rawAdversarialRecords);
const rawAdversarialFullBlockContext =
  rawAdversarialBlockContext(
    rawAdversarialRecords,
    rawAdversarialFullBlock,
  );
const rawAdversarialReplay =
  replayRawAdversarialContext(
    rawAdversarialFullBlockContext,
  );
assert.deepEqual(
  rawAdversarialOpeningEconomicState,
  rawAdversarialOpeningWitness.economic,
);
assert.deepEqual(
  rawAdversarialOpeningGenericState,
  rawAdversarialOpeningWitness.generic,
);
assert.deepEqual(
  rawAdversarialOpeningIdState,
  rawAdversarialOpeningWitness.id,
);
assert.deepEqual(
  rawAdversarialOpeningWorkState,
  rawAdversarialOpeningWitness.work,
);

function rawAggregateWorkSendFixture({
  amountVersion,
  feeSats,
  registryPayments,
  thirdMessage = "",
}) {
  const messages = [
    `pwt1:${amountVersion}:${WORK_TOKEN_ID}:1:${WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS}`,
    `pwt1:${amountVersion}:${WORK_TOKEN_ID}:1:${WORK_AMO_V5_ID_REGISTRY_ADDRESS}`,
    ...(thirdMessage ? [thirdMessage] : []),
  ];
  const mailMessage = "pwm1:m:aggregate-work-send";
  const tx = {
    vin: [
      {
        prevout: {
          scriptpubkey_address: rawAdversarialActor,
        },
        txid: hash("d"),
        vout: 0,
      },
    ],
    vout: [
      {
        scriptpubkey_address: rawAdversarialActor,
        value: 1,
      },
      {
        scriptpubkey:
          rawAdversarialOpReturnScript(mailMessage),
        value: 0,
      },
      ...registryPayments.map((value) => ({
        scriptpubkey_address:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        value,
      })),
      ...messages.map((message) => ({
        scriptpubkey:
          rawAdversarialOpReturnScript(message),
        value: 0,
      })),
    ],
  };
  const hydrated = rawAdversarialHydratedTransaction({
    feeSats,
    tx,
  });
  const protocolVouts = [
    1,
    ...messages.map(
      (_message, index) =>
        2 + registryPayments.length + index,
    ),
  ];
  return {
    feeSats,
    records: protocolVouts.map((protocolVout) =>
      rawAdversarialRecord({
        blockHash: rawAdversarialBlockHash,
        blockHeight: rawAdversarialBlockHeight,
        blockTransactionIndex: 1,
        feeSats,
        protocolVout,
        tx,
        txid: hydrated.txid,
      })
    ),
    txid: hydrated.txid,
  };
}

function rawAggregateWorkSendReplay(
  fixture,
  options = {},
) {
  return replayRawAdversarialContext(
    rawAdversarialBlockContext(fixture.records),
    options,
  );
}

function rawAggregateWorkSendOutcomes(replay, txid) {
  return replay.events.filter(
    (event) =>
      event.txid === txid &&
      event.protocol === "pwt1" &&
      event.parsed?.kind === "send" &&
      event.parsed?.tokenId === WORK_TOKEN_ID,
  );
}

function assertAggregateWorkSendAccounting(
  replay,
  fixture,
  amountField,
) {
  const outcomes = rawAggregateWorkSendOutcomes(
    replay,
    fixture.txid,
  );
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((outcome) => outcome.valid));
  assert.deepEqual(
    outcomes.map((outcome) => outcome.output[amountField]),
    ["1", "1"],
  );
  assert.deepEqual(
    outcomes.map(
      (outcome) =>
        outcome.stateDelta.economicOutputs[0],
    ),
    [
      {
        address:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        attributedSats: "546",
        outputSats: "1092",
        role: "pwt-token-registry",
        vout: 2,
      },
      {
        address:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        attributedSats: "546",
        outputSats: "1092",
        role: "pwt-token-registry",
        vout: 2,
      },
    ],
  );
  assert.equal(
    replay.economicState.baseState.tokenTransferFlowSats,
    "1092",
  );
  assert.deepEqual(
    replay.feeTransitions.filter(
      (transition) =>
        transition.txid === fixture.txid,
    ).map((transition) => ({
      fee: transition.transactionMinerFeeSats,
      valid: transition.valid,
    })),
    [{ fee: String(fixture.feeSats), valid: true }],
  );
  assert.equal(
    replay.economicState.creditFixedQ8,
    (
      BigInt(1_092 + fixture.feeSats) *
      100_000_000n
    ).toString(),
  );
}

const rawAggregateSend2Fixture =
  rawAggregateWorkSendFixture({
    amountVersion: "send2",
    feeSats: 43,
    registryPayments: [1_092],
  });
const rawAggregateSend2Replay =
  rawAggregateWorkSendReplay(rawAggregateSend2Fixture);
assertAggregateWorkSendAccounting(
  rawAggregateSend2Replay,
  rawAggregateSend2Fixture,
  "amountAtoms",
);
assert.equal(
  rawAggregateSend2Replay.workState.holders.find(
    ({ address }) => address === rawAdversarialActor,
  )?.balanceAtoms,
  "8",
);

const rawAggregateQ16OpeningWorkState =
  normalizeWorkAmoV5RawWorkState({
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms: "10",
    holders: [
      {
        address: rawAdversarialActor,
        balanceSubatoms: "10",
      },
    ],
    listings: [],
  });
const rawAggregateQ16OpeningEconomicState =
  buildRawAdversarialOpeningEconomicState({
    genericState: rawAdversarialOpeningGenericState,
    idState: rawAdversarialOpeningIdState,
    priorBlockHash: rawAdversarialPriorBlockHash,
    priorBlockHeight: rawAdversarialBlockHeight - 1,
    workState: rawAggregateQ16OpeningWorkState,
  });
const rawAggregateSend3Fixture =
  rawAggregateWorkSendFixture({
    amountVersion: "send3",
    feeSats: 47,
    registryPayments: [1_092],
  });
const rawAggregateSend3Replay =
  rawAggregateWorkSendReplay(rawAggregateSend3Fixture, {
    openingEconomicState:
      rawAggregateQ16OpeningEconomicState,
    openingWorkState: rawAggregateQ16OpeningWorkState,
    workAmoV8: {
      activationHeight: rawAdversarialBlockHeight,
    },
  });
assertAggregateWorkSendAccounting(
  rawAggregateSend3Replay,
  rawAggregateSend3Fixture,
  "amountSubatoms",
);
assert.equal(
  rawAggregateSend3Replay.workState.holders.find(
    ({ address }) => address === rawAdversarialActor,
  )?.balanceSubatoms,
  "8",
);

function rawQ16MintReplay(amount) {
  const message = `pwt1:mint:${WORK_TOKEN_ID}:${amount}`;
  const tx = {
    vin: [
      {
        prevout: {
          scriptpubkey_address: rawAdversarialActor,
        },
        txid: hash("e"),
        vout: 0,
      },
    ],
    vout: [
      {
        scriptpubkey_address:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        value: 1_000,
      },
      {
        scriptpubkey: rawAdversarialOpReturnScript(message),
        value: 0,
      },
    ],
  };
  const hydrated = rawAdversarialHydratedTransaction({
    feeSats: 41,
    tx,
  });
  const openingWorkState = normalizeWorkAmoV5RawWorkState({
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms: "0",
    holders: [],
    listings: [],
  });
  const openingEconomicState =
    buildRawAdversarialOpeningEconomicState({
      genericState: rawAdversarialOpeningGenericState,
      idState: rawAdversarialOpeningIdState,
      priorBlockHash: rawAdversarialPriorBlockHash,
      priorBlockHeight: rawAdversarialBlockHeight - 1,
      workState: openingWorkState,
    });
  const record = rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 1,
    feeSats: 41,
    protocolVout: 1,
    tx,
    txid: hydrated.txid,
  });
  return replayRawAdversarialContext(
    rawAdversarialBlockContext([record]),
    {
      openingEconomicState,
      openingWorkState,
      workAmoV8: {
        activationHeight: rawAdversarialBlockHeight,
      },
    },
  );
}

for (const invalidWireAmount of [
  "1",
  "01000",
  "1e3",
  "+1000",
  "1000.0",
]) {
  const invalidQ16MintReplay = rawQ16MintReplay(
    invalidWireAmount,
  );
  const invalidQ16Mint = invalidQ16MintReplay.events.find(
    (event) =>
      event.protocol === "pwt1" &&
      event.parsed?.kind === "mint" &&
      event.parsed?.tokenId === WORK_TOKEN_ID,
  );
  assert.equal(invalidQ16Mint?.valid, false);
  assert.equal(
    invalidQ16MintReplay.workState.confirmedSupplySubatoms,
    "0",
  );
}

const exactQ16MintReplay = rawQ16MintReplay(1_000);
const exactQ16Mint = exactQ16MintReplay.events.find(
  (event) =>
    event.protocol === "pwt1" &&
    event.parsed?.kind === "mint" &&
    event.parsed?.tokenId === WORK_TOKEN_ID,
);
assert.equal(exactQ16Mint?.valid, true);
assert.equal(
  exactQ16MintReplay.workState.confirmedSupplySubatoms,
  "10000000000000000000",
);

for (const registryPayments of [[1_091], [1_093]]) {
  const fixture = rawAggregateWorkSendFixture({
    amountVersion: "send2",
    feeSats: 53,
    registryPayments,
  });
  const replay = rawAggregateWorkSendReplay(fixture);
  const outcomes = rawAggregateWorkSendOutcomes(
    replay,
    fixture.txid,
  );
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((outcome) => !outcome.valid));
  assert.ok(
    outcomes.every(
      (outcome) =>
        outcome.reasonCode ===
          "work-amo-v5-distinct-registry-payment-unavailable",
    ),
  );
  assert.equal(
    replay.economicState.baseState.tokenTransferFlowSats,
    "0",
  );
}

const rawDistinctSend2Fixture =
  rawAggregateWorkSendFixture({
    amountVersion: "send2",
    feeSats: 57,
    registryPayments: [546, 546],
  });
const rawDistinctSend2Replay =
  rawAggregateWorkSendReplay(rawDistinctSend2Fixture);
const rawDistinctSend2Outcomes =
  rawAggregateWorkSendOutcomes(
    rawDistinctSend2Replay,
    rawDistinctSend2Fixture.txid,
  );
assert.ok(
  rawDistinctSend2Outcomes.every(
    (outcome) => outcome.valid,
  ),
);
assert.deepEqual(
  rawDistinctSend2Outcomes.map(
    (outcome) =>
      outcome.stateDelta.economicOutputs[0].vout,
  ),
  [2, 3],
);
assert.equal(
  rawDistinctSend2Replay.economicState.baseState
    .tokenTransferFlowSats,
  "1092",
);

const rawAggregateCrossTokenId = hash("d");
const rawAggregateCrossTokenGenericState =
  normalizeWorkAmoV5RawGenericState({
    holders: [
      {
        address: rawAdversarialActor,
        balance: "1",
        tokenId: rawAggregateCrossTokenId,
      },
    ],
    listings: [],
    tokens: [
      {
        confirmedSupply: "1",
        maxSupply: "10",
        mintAmount: "1",
        mintPriceSats: "546",
        registryAddress:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        ticker: "EDGE",
        tokenId: rawAggregateCrossTokenId,
      },
    ],
  });
const rawAggregateCrossTokenEconomicState =
  buildRawAdversarialOpeningEconomicState({
    genericState: rawAggregateCrossTokenGenericState,
    idState: rawAdversarialOpeningIdState,
    priorBlockHash: rawAdversarialPriorBlockHash,
    priorBlockHeight: rawAdversarialBlockHeight - 1,
    workState: rawAdversarialOpeningWorkState,
  });
const rawAggregateCrossTokenFixture =
  rawAggregateWorkSendFixture({
    amountVersion: "send2",
    feeSats: 59,
    registryPayments: [1_092],
    thirdMessage:
      `pwt1:send:${rawAggregateCrossTokenId}:1:` +
      WORK_AMO_V5_ID_REGISTRY_ADDRESS,
  });
const rawAggregateCrossTokenReplay =
  rawAggregateWorkSendReplay(
    rawAggregateCrossTokenFixture,
    {
      openingEconomicState:
        rawAggregateCrossTokenEconomicState,
      openingGenericState:
        rawAggregateCrossTokenGenericState,
    },
  );
assert.ok(
  rawAggregateWorkSendOutcomes(
    rawAggregateCrossTokenReplay,
    rawAggregateCrossTokenFixture.txid,
  ).every((outcome) => !outcome.valid),
);
assert.equal(
  rawAggregateCrossTokenReplay.events.filter(
    (event) =>
      event.txid === rawAggregateCrossTokenFixture.txid &&
      event.parsed?.tokenId === rawAggregateCrossTokenId,
  ).filter((event) => event.valid).length,
  1,
);
assert.equal(
  rawAggregateCrossTokenReplay.economicState.baseState
    .tokenTransferFlowSats,
  "546",
);

function rawAdversarialTamperAddressLabels(
  transaction,
  label,
) {
  for (const output of transaction.vout) {
    if (output.scriptpubkey_address !== undefined) {
      output.scriptpubkey_address = label;
    }
  }
  for (const input of transaction.vin) {
    if (input.prevout?.scriptpubkey_address !== undefined) {
      input.prevout.scriptpubkey_address = label;
    }
  }
}

const rawAddressLabelTamperRecords =
  structuredClone(rawAdversarialRecords);
for (const record of rawAddressLabelTamperRecords) {
  rawAdversarialTamperAddressLabels(
    record.tx,
    "record-forged-address-label",
  );
  record.blockTime = 1;
  record.createdAt = "1970-01-01T00:00:00.001Z";
  record.time = 1;
  record.tx.blockhash = hash("0");
  record.tx.blockheight = 1;
  record.tx.blockindex = 999;
  record.tx.status = {
    block_hash: hash("f"),
    block_height: 2,
    block_index: 998,
    block_time: 1,
    confirmed: false,
  };
  record.tx.time = 1;
}
const rawAddressLabelTamperFullBlock =
  structuredClone(rawAdversarialFullBlock);
for (const transaction of rawAddressLabelTamperFullBlock) {
  rawAdversarialTamperAddressLabels(
    transaction,
    "block-forged-address-label",
  );
  transaction.blockhash = hash("0");
  transaction.blockheight = 3;
  transaction.blockindex = 997;
  transaction.status = {
    block_hash: hash("e"),
    block_height: 4,
    block_index: 996,
    block_time: 4_000_000_000,
    confirmed: false,
  };
  transaction.time = 4_000_000_000;
}
const rawAddressLabelTamperReplay =
  replayRawAdversarialRecords(
    rawAddressLabelTamperRecords,
    rawAddressLabelTamperFullBlock,
  );
assertRawAdversarialClosingRootsEqual(
  rawAdversarialReplay,
  rawAddressLabelTamperReplay,
);
assert.deepEqual(
  rawAdversarialReplay.blockDescriptorCommitment,
  rawAddressLabelTamperReplay.blockDescriptorCommitment,
);
assert.deepEqual(
  rawAdversarialReplay.transitionChainCommitment,
  rawAddressLabelTamperReplay.transitionChainCommitment,
);

const rawHeaderTimeMutationBytes = Buffer.from(
  rawAdversarialFullBlockContext.blockHeaderHex,
  "hex",
);
rawHeaderTimeMutationBytes.writeUInt32LE(
  rawHeaderTimeMutationBytes.readUInt32LE(68) + 1,
  68,
);
const rawHeaderTimeMutationHash = Buffer.from(
  rawAdversarialDoubleSha256(rawHeaderTimeMutationBytes),
).reverse().toString("hex");
const rawHeaderTimeMutationReplay =
  replayRawAdversarialContext({
    ...rawAdversarialFullBlockContext,
    blockHash: rawHeaderTimeMutationHash,
    blockHeaderHex:
      rawHeaderTimeMutationBytes.toString("hex"),
    records:
      rawAdversarialFullBlockContext.records.map(
        (record) => ({
          ...structuredClone(record),
          position: {
            ...record.position,
            blockHash: rawHeaderTimeMutationHash,
          },
        }),
      ),
  });
assertRawAdversarialLogicalStateEqual(
  rawAdversarialReplay,
  rawHeaderTimeMutationReplay,
);
assert.notDeepEqual(
  rawAdversarialReplay.blockDescriptorCommitment,
  rawHeaderTimeMutationReplay.blockDescriptorCommitment,
);
assert.notDeepEqual(
  rawAdversarialReplay.stateCommitment,
  rawHeaderTimeMutationReplay.stateCommitment,
);
assert.notDeepEqual(
  rawAdversarialReplay.transitionChainCommitment,
  rawHeaderTimeMutationReplay.transitionChainCommitment,
);

const rawExpiryBoundarySeconds = 1_700_000_100;
const rawExpiryAuthorization = {
  ...rawGenericSaleAuthorization,
  expiresAt: new Date(
    rawExpiryBoundarySeconds * 1_000,
  ).toISOString(),
  nonce: "raw-header-expiry-boundary",
};
const rawExpiryMessage =
  `pwt1:list5:${Buffer.from(
    JSON.stringify(rawExpiryAuthorization),
    "utf8",
  ).toString("base64url")}`;
const rawExpiryTx = {
  vin: [
    {
      prevout: {
        scriptpubkey_address: rawAdversarialActor,
      },
      txid: hash("a"),
      vout: 4,
    },
  ],
  vout: [
    {
      scriptpubkey_address: rawAdversarialGenericRegistry,
      value: 546,
    },
    {
      scriptpubkey_address: rawAdversarialActor,
      value: 1,
    },
    {
      scriptpubkey:
        rawExpiryAuthorization.anchorScriptPubKey,
      value: rawExpiryAuthorization.anchorValueSats,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(rawExpiryMessage),
      value: 0,
    },
  ],
};
const rawExpiryTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 43,
    tx: rawExpiryTx,
  }).txid;
const rawExpiryRecord = rawAdversarialRecord({
  blockHash: rawAdversarialBlockHash,
  blockHeight: rawAdversarialBlockHeight,
  blockTransactionIndex: 1,
  feeSats: 43,
  message: rawExpiryMessage,
  protocol: "pwt1",
  protocolVout: 3,
  tx: rawExpiryTx,
  txid: rawExpiryTxid,
});
const rawExpiryOpeningGenericState =
  normalizeWorkAmoV5RawGenericState({
    ...structuredClone(rawAdversarialOpeningGenericState),
    holders: [
      ...rawAdversarialOpeningGenericState.holders,
      {
        address: rawAdversarialActor,
        balance: "1",
        tokenId: rawAdversarialGenericTokenId,
      },
    ],
    tokens:
      rawAdversarialOpeningGenericState.tokens.map(
        (token) =>
          token.tokenId === rawAdversarialGenericTokenId
            ? {
                ...token,
                confirmedSupplyAtoms: "1",
              }
            : token,
      ),
  });
const rawExpiryOpeningEconomicState =
  buildRawAdversarialOpeningEconomicState({
    genericState: rawExpiryOpeningGenericState,
    idState: rawAdversarialOpeningIdState,
    priorBlockHash: rawAdversarialPriorBlockHash,
    priorBlockHeight: rawAdversarialBlockHeight - 1,
    workState: rawAdversarialOpeningWorkState,
  });
const replayRawExpiryAt = (blockTimeSeconds) => {
  const records = [rawExpiryRecord];
  const blockTransactions =
    rawAdversarialBlockTransactions(records);
  return replayRawAdversarialContext(
    rawAdversarialBlockContext(
      records,
      blockTransactions,
      { blockTimeSeconds },
    ),
    {
      openingEconomicState:
        rawExpiryOpeningEconomicState,
      openingGenericState:
        rawExpiryOpeningGenericState,
    },
  );
};
const rawExpiryAtBoundaryReplay =
  replayRawExpiryAt(rawExpiryBoundarySeconds);
const rawExpiryAfterBoundaryReplay =
  replayRawExpiryAt(rawExpiryBoundarySeconds + 1);
assert.equal(
  rawExpiryAtBoundaryReplay.outcomes.get(
    `${rawExpiryTxid}:3:0`,
  )?.valid,
  true,
);
assert.equal(
  rawExpiryAtBoundaryReplay.genericState.listings.length,
  1,
);
assert.equal(
  rawExpiryAfterBoundaryReplay.outcomes.get(
    `${rawExpiryTxid}:3:0`,
  )?.valid,
  false,
);
assert.equal(
  rawExpiryAfterBoundaryReplay.outcomes.get(
    `${rawExpiryTxid}:3:0`,
  )?.reasonCode,
  "work-amo-v5-generic-list-invalid",
);
assert.equal(
  rawExpiryAfterBoundaryReplay.genericState.listings.length,
  0,
);

const rawAdversarialOutcome = (txid, protocolVout) =>
  rawAdversarialReplay.outcomes.get(
    `${txid}:${protocolVout}:0`,
  );
const rawInvalidWorkOutcome = rawAdversarialOutcome(
  rawAdversarialWorkTxid,
  1,
);
const rawValidWorkOutcome = rawAdversarialOutcome(
  rawAdversarialWorkTxid,
  2,
);
assert.equal(rawInvalidWorkOutcome?.valid, false);
assert.equal(
  rawInvalidWorkOutcome?.reasonCode,
  "work-amo-v5-raw-mint-state-invalid",
);
assert.equal(rawValidWorkOutcome?.valid, true);
assert.deepEqual(
  rawValidWorkOutcome?.stateDelta.economicOutputs.map(
    ({ role, vout }) => ({ role, vout }),
  ),
  [{ role: "pwt-token-registry", vout: 0 }],
);
assert.equal(
  rawAdversarialReplay.workState.holders.find(
    ({ address }) => address === rawAdversarialActor,
  )?.balanceAtoms,
  "9",
);
assert.equal(
  rawAdversarialReplay.workState.holders.find(
    ({ address }) => address === rawAdversarialRecipient,
  )?.balanceAtoms,
  "1",
);

const rawInvalidGenericOutcome = rawAdversarialOutcome(
  rawAdversarialGenericTxid,
  2,
);
const rawValidGenericOutcome = rawAdversarialOutcome(
  rawAdversarialGenericTxid,
  3,
);
assert.equal(rawInvalidGenericOutcome?.valid, false);
assert.equal(
  rawInvalidGenericOutcome?.reasonCode,
  "work-amo-v5-generic-mint-invalid",
);
assert.equal(rawValidGenericOutcome?.valid, true);
assert.deepEqual(
  rawValidGenericOutcome?.stateDelta.economicOutputs.map(
    ({ role, vout }) => ({ role, vout }),
  ),
  [{ role: "pwt-token-registry", vout: 0 }],
);
assert.equal(
  rawAdversarialReplay.genericState.holders.find(
    ({ address, tokenId }) =>
      address === rawAdversarialGenericRegistry &&
      tokenId === WORK_AMO_V5_POWB_TOKEN_ID,
  ),
  undefined,
);
assert.equal(
  rawAdversarialReplay.genericState.holders.find(
    ({ address, tokenId }) =>
      address === rawAdversarialActor &&
      tokenId === rawAdversarialGenericTokenId,
  )?.balance,
  "1",
);
assert.equal(
  rawAdversarialReplay.genericState.tokens.find(
    ({ tokenId }) => tokenId === WORK_AMO_V5_POWB_TOKEN_ID,
  )?.confirmedSupplyAtoms,
  "77",
);

const rawInvalidIdOutcome = rawAdversarialOutcome(
  rawAdversarialIdTxid,
  1,
);
const rawValidIdOutcome = rawAdversarialOutcome(
  rawAdversarialIdTxid,
  2,
);
assert.deepEqual(
  rawAdversarialReplay.events
    .filter(({ txid }) => txid === rawAdversarialIdTxid)
    .map((event) => ({
      protocolVout: event.position.protocolVout,
      valid: event.valid,
    })),
  [
    { protocolVout: 1, valid: false },
    { protocolVout: 2, valid: true },
  ],
  "one PWID transaction must retain its invalid and valid outcomes in physical order",
);
assert.equal(rawInvalidIdOutcome?.valid, false);
assert.equal(
  rawInvalidIdOutcome?.reasonCode,
  "work-amo-v5-id-update-owner-invalid",
);
assert.equal(rawValidIdOutcome?.valid, true);
assert.deepEqual(
  rawValidIdOutcome?.stateDelta.economicOutputs.map(
    ({ role, vout }) => ({ role, vout }),
  ),
  [{ role: "pwid-registry", vout: 0 }],
);
assert.equal(
  rawAdversarialReplay.idState.records.find(
    ({ id }) => id === "bob",
  )?.receiveAddress,
  WORK_AMO_V5_ID_REGISTRY_ADDRESS,
);
assert.equal(
  rawAdversarialReplay.idState.records.find(
    ({ id }) => id === "alice",
  )?.receiveAddress,
  rawAdversarialRecipient,
);

const rawBothInvalidIdMessages = [
  rawAdversarialInvalidIdMessage,
  `pwid1:u:${Buffer.from("unknown-id", "utf8").toString("base64url")}:` +
    rawAdversarialRecipient,
];
const rawBothInvalidIdTx = {
  vin: [
    {
      prevout: { scriptpubkey_address: rawAdversarialActor },
      txid: hash("6"),
      vout: 0,
    },
  ],
  vout: [
    {
      scriptpubkey_address: WORK_AMO_V5_ID_REGISTRY_ADDRESS,
      value: 546,
    },
    ...rawBothInvalidIdMessages.map((message) => ({
      scriptpubkey: rawAdversarialOpReturnScript(message),
      value: 0,
    })),
  ],
};
const rawBothInvalidIdHydrated = rawAdversarialHydratedTransaction({
  feeSats: 31,
  tx: rawBothInvalidIdTx,
});
const rawBothInvalidIdRecords = rawBothInvalidIdMessages.map(
  (message, messageIndex) =>
    rawAdversarialRecord({
      blockHash: rawAdversarialBlockHash,
      blockHeight: rawAdversarialBlockHeight,
      blockTransactionIndex: 1,
      feeSats: 31,
      message,
      protocol: "pwid1",
      protocolVout: messageIndex + 1,
      transactionProtocolRecordCount: 2,
      tx: rawBothInvalidIdHydrated,
      txid: rawBothInvalidIdHydrated.txid,
    }),
);
const rawBothInvalidIdReplay = replayRawAdversarialRecords(
  rawBothInvalidIdRecords,
);
assert.deepEqual(
  rawBothInvalidIdReplay.events.map((event) => ({
    protocolVout: event.position.protocolVout,
    reasonCode: event.reasonCode,
    valid: event.valid,
  })),
  [
    {
      protocolVout: 1,
      reasonCode: "work-amo-v5-id-update-owner-invalid",
      valid: false,
    },
    {
      protocolVout: 2,
      reasonCode: "work-amo-v5-id-update-owner-invalid",
      valid: false,
    },
  ],
  "two invalid PWID records in one transaction must both remain replay outcomes",
);

const rawAdversarialDerivedEvent =
  rawAdversarialReplay.events.find(
    ({ txid }) => txid === rawAdversarialDerivedTxid,
  );
assert.equal(rawAdversarialDerivedEvent?.valid, true);
assert.equal(rawAdversarialDerivedEvent?.derived.length, 1);
assert.deepEqual(
  rawAdversarialDerivedEvent?.derived[0]
    ?.parentTransitionChainCommitmentAfter,
  rawAdversarialDerivedEvent?.transitionChainCommitmentAfter,
);

assert.equal(
  rawAdversarialReplay.transitionChainModel,
  WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
);
assert.equal(
  rawAdversarialReplay.blockDescriptorModel,
  WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
);
assert.deepEqual(rawAdversarialReplay.bip141Witness, {
  commitmentSha256: "",
  commitmentVout: null,
  model: WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
  required: false,
  witnessMerkleRootInternalHex: "",
  witnessTransactionCount: 0,
});
assert.equal(
  rawAdversarialReplay.blockTransactionCount,
  rawAdversarialFullBlock.length,
);
assert.equal(
  rawAdversarialReplay.rawProtocolCandidateCount,
  9,
);
assert.match(
  rawAdversarialReplay.blockDescriptorCommitment.sha256,
  /^[0-9a-f]{64}$/u,
);
const rawZeroCandidateFullBlock = Array.from(
  { length: 3 },
  (_, blockTransactionIndex) => {
    let transaction =
      blockTransactionIndex === 0
        ? rawAdversarialCoinbaseTransaction(20)
        : rawAdversarialNeutralTransaction(
            blockTransactionIndex + 20,
          );
    if (blockTransactionIndex === 1) {
      const withUnknownScript = structuredClone(transaction);
      withUnknownScript.vout[0] = {
        scriptpubkey: "51",
        value: 0,
      };
      transaction = rawAdversarialHydratedTransaction({
        feeSats: 0,
        tx: withUnknownScript,
      });
    }
    return {
      ...transaction,
      _powBlockIndex: blockTransactionIndex,
    };
  },
);
assert.equal(
  rawZeroCandidateFullBlock[1].vout[0].scriptpubkey,
  "51",
);
const rawZeroCandidateReplay =
  replayRawAdversarialContext(
    rawAdversarialBlockContext(
      [],
      rawZeroCandidateFullBlock,
    ),
  );
assert.equal(
  rawZeroCandidateReplay.blockDescriptorModel,
  WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
);
assert.equal(
  rawZeroCandidateReplay.blockTransactionCount,
  rawZeroCandidateFullBlock.length,
);
assert.equal(rawZeroCandidateReplay.protocolRecordCount, 0);
assert.equal(rawZeroCandidateReplay.rawProtocolCandidateCount, 0);
assert.equal(rawZeroCandidateReplay.transactionCount, 0);
assert.equal(rawZeroCandidateReplay.events.length, 0);
assert.equal(rawZeroCandidateReplay.feeTransitions.length, 0);
assert.match(
  rawZeroCandidateReplay.blockDescriptorCommitment.sha256,
  /^[0-9a-f]{64}$/u,
);

const rawSegwitWitnessReservedValue = "11".repeat(32);
const rawSegwitTx = structuredClone(
  rawAdversarialRecords.find(
    ({ txid }) => txid === rawAdversarialInvalidOnlyATxid,
  ).tx,
);
rawSegwitTx.vin[0].txinwitness = ["01"];
const rawSegwitRecord = rawAdversarialRecord({
  blockHash: rawAdversarialBlockHash,
  blockHeight: rawAdversarialBlockHeight,
  blockTransactionIndex: 1,
  feeSats: 23,
  message: rawAdversarialInvalidOnlyAMessage,
  protocol: "pwt1",
  protocolVout: 0,
  tx: rawSegwitTx,
  txid: rawAdversarialInvalidOnlyATxid,
});
const rawSegwitTemporaryCoinbase =
  rawAdversarialCoinbaseTransaction(100);
const rawSegwitCommitmentScript =
  rawAdversarialWitnessCommitmentScript(
    [
      rawSegwitTemporaryCoinbase,
      rawSegwitRecord.tx,
    ],
    rawSegwitWitnessReservedValue,
  );
const rawSegwitCoinbase =
  rawAdversarialCoinbaseTransaction(100, {
    commitmentScriptPubKey: rawSegwitCommitmentScript,
    witnessReservedValue:
      rawSegwitWitnessReservedValue,
  });
const rawSegwitFullBlock = [
  {
    ...rawSegwitCoinbase,
    _powBlockIndex: 0,
  },
  {
    ...rawSegwitRecord.tx,
    _powBlockIndex: 1,
  },
];
const rawSegwitReplay = replayRawAdversarialRecords(
  [rawSegwitRecord],
  rawSegwitFullBlock,
);
assert.equal(
  rawSegwitReplay.bip141Witness.model,
  WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
);
assert.equal(rawSegwitReplay.bip141Witness.required, true);
assert.equal(
  rawSegwitReplay.bip141Witness.commitmentVout,
  1,
);
assert.equal(
  rawSegwitReplay.bip141Witness.commitmentSha256,
  rawSegwitCommitmentScript.slice(12, 76),
);
assert.equal(
  rawSegwitReplay.bip141Witness
    .coinbaseWitnessReservedValueHex,
  rawSegwitWitnessReservedValue,
);
assert.equal(
  rawSegwitReplay.bip141Witness.witnessTransactionCount,
  2,
);

const rawSegwitWitnessMutationTx =
  structuredClone(rawSegwitRecord.tx);
rawSegwitWitnessMutationTx.vin[0].txinwitness = ["02"];
const rawSegwitWitnessMutationRecord =
  rawAdversarialRecord({
    blockHash: rawAdversarialBlockHash,
    blockHeight: rawAdversarialBlockHeight,
    blockTransactionIndex: 1,
    feeSats: 23,
    message: rawAdversarialInvalidOnlyAMessage,
    protocol: "pwt1",
    protocolVout: 0,
    tx: rawSegwitWitnessMutationTx,
    txid: rawAdversarialInvalidOnlyATxid,
  });
assert.throws(
  () =>
    replayRawAdversarialRecords(
      [rawSegwitWitnessMutationRecord],
      [
        rawSegwitFullBlock[0],
        {
          ...rawSegwitWitnessMutationRecord.tx,
          _powBlockIndex: 1,
        },
      ],
    ),
  /work-amo-v5-raw-witness-commitment-mismatch/u,
);

const rawSegwitMissingCommitmentCoinbase =
  rawAdversarialCoinbaseTransaction(101, {
    witnessReservedValue:
      rawSegwitWitnessReservedValue,
  });
assert.throws(
  () =>
    replayRawAdversarialRecords(
      [rawSegwitRecord],
      [
        {
          ...rawSegwitMissingCommitmentCoinbase,
          _powBlockIndex: 0,
        },
        rawSegwitFullBlock[1],
      ],
    ),
  /work-amo-v5-raw-witness-commitment-required/u,
);

const rawSegwitBadCommitmentScript =
  `6a24aa21a9ed${"00".repeat(32)}`;
const rawSegwitBadCommitmentCoinbase =
  rawAdversarialCoinbaseTransaction(102, {
    commitmentScriptPubKey:
      rawSegwitBadCommitmentScript,
    witnessReservedValue:
      rawSegwitWitnessReservedValue,
  });
assert.throws(
  () =>
    replayRawAdversarialRecords(
      [rawSegwitRecord],
      [
        {
          ...rawSegwitBadCommitmentCoinbase,
          _powBlockIndex: 0,
        },
        rawSegwitFullBlock[1],
      ],
    ),
  /work-amo-v5-raw-witness-commitment-mismatch/u,
);

const rawSegwitMissingReservedCoinbase =
  rawAdversarialCoinbaseTransaction(103, {
    commitmentScriptPubKey: rawSegwitCommitmentScript,
  });
assert.throws(
  () =>
    replayRawAdversarialRecords(
      [rawSegwitRecord],
      [
        {
          ...rawSegwitMissingReservedCoinbase,
          _powBlockIndex: 0,
        },
        rawSegwitFullBlock[1],
      ],
    ),
  /work-amo-v5-raw-witness-reserved-value-invalid/u,
);

const rawSegwitHighestValidCoinbase =
  rawAdversarialCoinbaseTransaction(104, {
    commitmentScriptPubKeys: [
      rawSegwitBadCommitmentScript,
      rawSegwitCommitmentScript,
    ],
    witnessReservedValue:
      rawSegwitWitnessReservedValue,
  });
const rawSegwitHighestValidReplay =
  replayRawAdversarialRecords(
    [rawSegwitRecord],
    [
      {
        ...rawSegwitHighestValidCoinbase,
        _powBlockIndex: 0,
      },
      rawSegwitFullBlock[1],
    ],
  );
assert.equal(
  rawSegwitHighestValidReplay.bip141Witness.commitmentVout,
  2,
);
assert.equal(
  rawSegwitHighestValidReplay.bip141Witness.commitmentSha256,
  rawSegwitCommitmentScript.slice(12, 76),
);

const rawSegwitHighestInvalidCoinbase =
  rawAdversarialCoinbaseTransaction(105, {
    commitmentScriptPubKeys: [
      rawSegwitCommitmentScript,
      rawSegwitBadCommitmentScript,
    ],
    witnessReservedValue:
      rawSegwitWitnessReservedValue,
  });
assert.throws(
  () =>
    replayRawAdversarialRecords(
      [rawSegwitRecord],
      [
        {
          ...rawSegwitHighestInvalidCoinbase,
          _powBlockIndex: 0,
        },
        rawSegwitFullBlock[1],
      ],
    ),
  /work-amo-v5-raw-witness-commitment-mismatch/u,
);

const rawNonCoinbaseFirstFullBlock =
  structuredClone(rawAdversarialFullBlock);
rawNonCoinbaseFirstFullBlock[0] =
  rawAdversarialNeutralTransaction(999);
rawNonCoinbaseFirstFullBlock[0]._powBlockIndex = 0;
assert.throws(
  () =>
    replayRawAdversarialRecords(
      rawAdversarialRecords,
      rawNonCoinbaseFirstFullBlock,
    ),
  /work-amo-v5-raw-block-coinbase-invalid/u,
);

assert.match(
  rawAdversarialReplay.transitionChainCommitment.sha256,
  /^[0-9a-f]{64}$/u,
);
for (const event of rawAdversarialReplay.events) {
  assert.equal(
    event.transitionChainCommitmentAfter.model,
    WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
  );
  assert.deepEqual(
    event.transitionChainCommitmentAfter,
    rawAdversarialReplay.outcomes.get(
      `${event.txid}:${event.position.protocolVout}:${event.position.recordOrdinal}`,
    )?.transitionChainCommitmentAfter,
  );
}
for (const transition of rawAdversarialReplay.feeTransitions) {
  assert.equal(
    transition.transitionChainCommitmentAfter.model,
    WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
  );
}

const rawAdversarialReplayAgain = replayRawAdversarialRecords(
  structuredClone(rawAdversarialRecords),
);
assert.deepEqual(
  rawAdversarialReplayAgain.transitionChainCommitment,
  rawAdversarialReplay.transitionChainCommitment,
);
assert.deepEqual(
  rawAdversarialReplayAgain.blockDescriptorCommitment,
  rawAdversarialReplay.blockDescriptorCommitment,
);
assert.deepEqual(
  rawAdversarialReplayAgain.events.map(
    ({ transitionChainCommitmentAfter }) =>
      transitionChainCommitmentAfter,
  ),
  rawAdversarialReplay.events.map(
    ({ transitionChainCommitmentAfter }) =>
      transitionChainCommitmentAfter,
  ),
);
assert.deepEqual(
  rawAdversarialReplayAgain.feeTransitions.map(
    ({ transitionChainCommitmentAfter }) =>
      transitionChainCommitmentAfter,
  ),
  rawAdversarialReplay.feeTransitions.map(
    ({ transitionChainCommitmentAfter }) =>
      transitionChainCommitmentAfter,
  ),
);

const rawRollbackBaselineRecords = rawAdversarialRecords
  .filter(
    (record) =>
      !(
        (record.txid === rawAdversarialWorkTxid &&
          record.position.protocolVout === 1) ||
        (record.txid === rawAdversarialGenericTxid &&
          record.position.protocolVout === 2) ||
        (record.txid === rawAdversarialIdTxid &&
          record.position.protocolVout === 1)
      ),
  )
  .map((record) => {
    const omittedVout = new Map([
      [rawAdversarialWorkTxid, 1],
      [rawAdversarialGenericTxid, 2],
      [rawAdversarialIdTxid, 1],
    ]).get(record.txid);
    if (omittedVout === undefined) {
      return structuredClone(record);
    }
    const tx = structuredClone(record.tx);
    tx.vout[omittedVout] = {
      scriptpubkey: "6a00",
      value: 0,
    };
    return rawAdversarialRecord({
      blockHash: record.position.blockHash,
      blockHeight: record.position.blockHeight,
      blockTransactionIndex:
        record.position.blockTransactionIndex,
      feeSats: record.transactionMinerFeeSats,
      protocolVout: record.position.protocolVout,
      tx,
    });
  });
const rawRollbackBaselineReplay =
  replayRawAdversarialRecords(rawRollbackBaselineRecords);
assertRawAdversarialLogicalStateEqual(
  rawAdversarialReplay,
  rawRollbackBaselineReplay,
);
assert.notDeepEqual(
  rawAdversarialReplay.blockDescriptorCommitment,
  rawRollbackBaselineReplay.blockDescriptorCommitment,
);
assert.notDeepEqual(
  rawAdversarialReplay.stateCommitment,
  rawRollbackBaselineReplay.stateCommitment,
);
assert.notDeepEqual(
  rawAdversarialReplay.transitionChainCommitment,
  rawRollbackBaselineReplay.transitionChainCommitment,
);

const rawEvidenceMutationRecords =
  rawAdversarialRecords.map((record) => {
    if (record.txid !== rawAdversarialInvalidOnlyATxid) {
      return structuredClone(record);
    }
    const tx = structuredClone(record.tx);
    tx.vout[0].scriptpubkey = rawAdversarialOpReturnScript(
      "pwt1:invalid-but-different",
    );
    return rawAdversarialRecord({
      blockHash: record.position.blockHash,
      blockHeight: record.position.blockHeight,
      blockTransactionIndex:
        record.position.blockTransactionIndex,
      feeSats: record.transactionMinerFeeSats,
      protocolVout: record.position.protocolVout,
      tx,
    });
  });
const rawEvidenceMutationTxid =
  rawEvidenceMutationRecords.find(
    (record) =>
      record.position.blockTransactionIndex === 5,
  ).txid;
const rawEvidenceMutationReplay =
  replayRawAdversarialRecords(rawEvidenceMutationRecords);
assertRawAdversarialLogicalStateEqual(
  rawAdversarialReplay,
  rawEvidenceMutationReplay,
);
assert.equal(
  rawEvidenceMutationReplay.outcomes.get(
    `${rawEvidenceMutationTxid}:0:0`,
  )?.reasonCode,
  rawAdversarialReplay.outcomes.get(
    `${rawAdversarialInvalidOnlyATxid}:0:0`,
  )?.reasonCode,
);
assert.notDeepEqual(
  rawAdversarialReplay.blockDescriptorCommitment,
  rawEvidenceMutationReplay.blockDescriptorCommitment,
);
assert.notDeepEqual(
  rawAdversarialReplay.stateCommitment,
  rawEvidenceMutationReplay.stateCommitment,
);
assert.notDeepEqual(
  rawAdversarialReplay.transitionChainCommitment,
  rawEvidenceMutationReplay.transitionChainCommitment,
);

function assertRawTransactionEnvelopeTamperRejected(mutate) {
  const records = structuredClone(rawAdversarialRecords);
  const record = records.find(
    ({ txid }) => txid === rawAdversarialInvalidOnlyATxid,
  );
  mutate(record);
  assert.throws(
    () => replayRawAdversarialRecords(records),
    /work-amo-v5-raw-record-transaction-witness-mismatch/u,
  );
}

assertRawTransactionEnvelopeTamperRejected((record) => {
  record.message = "pwt1:forged-message";
});
assertRawTransactionEnvelopeTamperRejected((record) => {
  record.protocol = "pwa1";
});
assertRawTransactionEnvelopeTamperRejected((record) => {
  record.rawRecordParts[0].scriptPubKeyHex += "00";
});

const rawMissingCandidateRecords =
  structuredClone(rawAdversarialRecords).filter(
    (record) =>
      !(
        record.txid === rawAdversarialWorkTxid &&
        record.position.protocolVout === 1
      ),
  );
assert.throws(
  () => replayRawAdversarialRecords(rawMissingCandidateRecords),
  /work-amo-v5-raw-transaction-record-set-mismatch/u,
);

const rawExtraCandidateRecords =
  structuredClone(rawAdversarialRecords);
const rawExtraCandidate = structuredClone(
  rawExtraCandidateRecords.find(
    ({ txid }) => txid === rawAdversarialInvalidOnlyATxid,
  ),
);
rawExtraCandidate.position.protocolVout = 1;
rawExtraCandidate.protocolVout = 1;
rawExtraCandidateRecords.push(rawExtraCandidate);
assert.throws(
  () => replayRawAdversarialRecords(rawExtraCandidateRecords),
  /work-amo-v5-raw-transaction-record-set-mismatch/u,
);

assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockTransactions: [],
    }),
  /work-amo-v5-raw-block-transactions-required/u,
);
assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockHeaderHex: "00",
    }),
  /work-amo-v5-raw-block-header-invalid/u,
);
const rawHeaderWitnessMutation =
  `${rawAdversarialFullBlockContext.blockHeaderHex.slice(0, -2)}` +
  (
    rawAdversarialFullBlockContext.blockHeaderHex.endsWith("00")
      ? "01"
      : "00"
  );
assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockHeaderHex: rawHeaderWitnessMutation,
    }),
  /work-amo-v5-raw-block-header-witness-mismatch/u,
);

const rawReorderedFullBlock =
  structuredClone(rawAdversarialFullBlock);
[
  rawReorderedFullBlock[1],
  rawReorderedFullBlock[2],
] = [
  rawReorderedFullBlock[2],
  rawReorderedFullBlock[1],
];
for (
  let index = 0;
  index < rawReorderedFullBlock.length;
  index += 1
) {
  rawReorderedFullBlock[index]._powBlockIndex = index;
}
assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockTransactions: rawReorderedFullBlock,
    }),
  /work-amo-v5-raw-block-header-witness-mismatch/u,
);

const rawDuplicateFullBlock =
  structuredClone(rawAdversarialFullBlock);
rawDuplicateFullBlock[2] =
  structuredClone(rawDuplicateFullBlock[1]);
rawDuplicateFullBlock[2]._powBlockIndex = 2;
assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockTransactions: rawDuplicateFullBlock,
    }),
  /work-amo-v5-raw-block-transaction-envelope-invalid/u,
);

assert.throws(
  () =>
    replayRawAdversarialRecords(
      rawAdversarialRecords,
      rawAdversarialFullBlock.slice(0, -1),
    ),
  /work-amo-v5-raw-transaction-record-set-mismatch/u,
);
assert.throws(
  () =>
    replayRawAdversarialRecords(
      rawAdversarialRecords.filter(
        ({ txid }) => txid !== rawAdversarialInvalidOnlyBTxid,
      ),
      rawAdversarialFullBlock,
    ),
  /work-amo-v5-raw-transaction-record-set-mismatch/u,
);

const rawHydratedWitnessMismatchRecords =
  structuredClone(rawAdversarialRecords);
rawHydratedWitnessMismatchRecords.find(
  ({ txid }) => txid === rawAdversarialInvalidOnlyATxid,
).tx.vout[0].value = 1;
assert.throws(
  () =>
    replayRawAdversarialRecords(
      rawHydratedWitnessMismatchRecords,
      rawAdversarialFullBlock,
    ),
  /work-amo-v5-raw-hydrated-transaction-witness-mismatch/u,
);

const rawFeeWitnessMismatchRecords =
  structuredClone(rawAdversarialRecords);
rawFeeWitnessMismatchRecords.find(
  ({ txid }) => txid === rawAdversarialInvalidOnlyATxid,
).transactionMinerFeeSats = "24";
assert.throws(
  () =>
    replayRawAdversarialRecords(
      rawFeeWitnessMismatchRecords,
      rawAdversarialFullBlock,
    ),
  /work-amo-v5-raw-transaction-fee-witness-mismatch/u,
);

const rawMissingPrevoutFullBlock =
  structuredClone(rawAdversarialFullBlock);
delete rawMissingPrevoutFullBlock[1].vin[0].prevout;
assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockTransactions: rawMissingPrevoutFullBlock,
    }),
  /work-amo-v5-raw-transaction-prevout-witness-invalid/u,
);

const rawMissingSerializedWitnessFullBlock =
  structuredClone(rawAdversarialFullBlock);
delete rawMissingSerializedWitnessFullBlock[1].hex;
assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockTransactions:
        rawMissingSerializedWitnessFullBlock,
    }),
  /work-amo-v5-raw-serialized-transaction-witness-invalid/u,
);

const rawSerializedWitnessMismatchFullBlock =
  structuredClone(rawAdversarialFullBlock);
rawSerializedWitnessMismatchFullBlock[1].vout[0].value =
  String(
    BigInt(
      rawSerializedWitnessMismatchFullBlock[1].vout[0].value,
    ) + 1n,
  );
assert.throws(
  () =>
    replayRawAdversarialContext({
      ...rawAdversarialFullBlockContext,
      blockTransactions:
        rawSerializedWitnessMismatchFullBlock,
    }),
  /work-amo-v5-raw-serialized-transaction-witness-mismatch/u,
);

let rawMalformedTxid = "";
const rawMalformedTx = {
  vin: [],
  vout: [
    {
      // A complete "pwt1:" push followed by truncated PUSHDATA1.
      scriptpubkey: "6a05707774313a4c",
      value: 0,
    },
  ],
};
rawMalformedTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 31,
    tx: rawMalformedTx,
  }).txid;
const rawMalformedRecord = rawAdversarialRecord({
  blockHash: rawAdversarialBlockHash,
  blockHeight: rawAdversarialBlockHeight,
  blockTransactionIndex: 7,
  feeSats: 31,
  protocolVout: 0,
  tx: rawMalformedTx,
  txid: rawMalformedTxid,
});
assert.equal(rawMalformedRecord.rawDecodeValid, false);
assert.equal(
  rawMalformedRecord.rawDecodeReasonCode,
  CANONICAL_OP_RETURN_SCRIPT_MALFORMED,
);
assert.equal(
  rawMalformedRecord.rawRecordParts[0].decodeDetail,
  "pushdata1-length-truncated",
);
const rawMalformedReplay =
  replayRawAdversarialRecords([rawMalformedRecord]);
assert.equal(
  rawMalformedReplay.outcomes.get(
    `${rawMalformedTxid}:0:0`,
  )?.valid,
  false,
);
assert.equal(
  rawMalformedReplay.outcomes.get(
    `${rawMalformedTxid}:0:0`,
  )?.reasonCode,
  CANONICAL_OP_RETURN_SCRIPT_MALFORMED,
);
const rawMalformedDispositionTamper = structuredClone(
  rawMalformedRecord,
);
rawMalformedDispositionTamper.rawDecodeValid = true;
rawMalformedDispositionTamper.rawDecodeReasonCode = "";
assert.throws(
  () =>
    replayRawAdversarialRecords([
      rawMalformedDispositionTamper,
    ]),
  /work-amo-v5-raw-record-transaction-witness-mismatch/u,
);

let rawSemanticNulPwidTxid = "";
const rawSemanticNulPwidMessage =
  `pwid1:r2:${Buffer.from("semantic\u0000nul", "utf8").toString("base64url")}` +
  `:${rawAdversarialActor}:${rawAdversarialActor}`;
const rawSemanticNulPwidTx = {
  vin: [{
    prevout: {
      scriptpubkey_address: rawAdversarialActor,
    },
    txid: hash("1"),
    vout: 0,
  }],
  vout: [
    {
      scriptpubkey_address: WORK_AMO_V5_ID_REGISTRY_ADDRESS,
      value: 1_000,
    },
    {
      scriptpubkey: rawAdversarialOpReturnScript(
        rawSemanticNulPwidMessage,
      ),
      value: 0,
    },
  ],
};
rawSemanticNulPwidTxid = rawAdversarialHydratedTransaction({
  feeSats: 37,
  tx: rawSemanticNulPwidTx,
}).txid;
const rawSemanticNulPwidRecord = rawAdversarialRecord({
  blockHash: rawAdversarialBlockHash,
  blockHeight: rawAdversarialBlockHeight,
  blockTransactionIndex: 8,
  feeSats: 37,
  message: rawSemanticNulPwidMessage,
  protocol: "pwid1",
  protocolVout: 1,
  tx: rawSemanticNulPwidTx,
  txid: rawSemanticNulPwidTxid,
});
assert.equal(rawSemanticNulPwidRecord.rawDecodeValid, true);
assert.equal(rawSemanticNulPwidRecord.rawDecodeReasonCode, "");
const rawSemanticNulPwidReplay = replayRawAdversarialRecords([
  rawSemanticNulPwidRecord,
]);
const rawSemanticNulPwidOutcome =
  rawSemanticNulPwidReplay.outcomes.get(
    `${rawSemanticNulPwidTxid}:1:0`,
  );
assert.equal(rawSemanticNulPwidOutcome?.valid, false);
assert.equal(
  rawSemanticNulPwidOutcome?.reasonCode,
  "work-amo-v5-raw-pwid-invalid",
);
assert.equal(rawSemanticNulPwidOutcome?.parsed, null);
assert.equal(
  JSON.stringify(rawSemanticNulPwidReplay).includes("\u0000"),
  false,
  "A wire-safe decoded U+0000 must not enter replay state or evidence JSON.",
);

let rawPwmAggregateTxid = "";
const rawPwmAggregateSubject =
  `pwm1:s:${Buffer.from("Aggregate proof", "utf8").toString("base64url")}`;
const rawPwmAggregateMemo = "pwm1:m:powb";
const rawPwmAggregateTx = {
  vin: [
    {
      prevout: {
        scriptpubkey_address: rawAdversarialActor,
      },
      txid: hash("f"),
      vout: 0,
    },
  ],
  vout: [
    {
      scriptpubkey_address: rawAdversarialActor,
      value: 77,
    },
    {
      scriptpubkey: rawAdversarialOpReturnScript(
        rawPwmAggregateSubject,
      ),
      value: 0,
    },
    {
      scriptpubkey: rawAdversarialOpReturnScript(
        rawPwmAggregateMemo,
      ),
      value: 0,
    },
  ],
};
rawPwmAggregateTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 37,
    tx: rawPwmAggregateTx,
  }).txid;
const rawPwmAggregateRecord = rawAdversarialRecord({
  blockHash: rawAdversarialBlockHash,
  blockHeight: rawAdversarialBlockHeight,
  blockTransactionIndex: 8,
  feeSats: 37,
  protocolVout: 1,
  tx: rawPwmAggregateTx,
  txid: rawPwmAggregateTxid,
});
assert.equal(
  rawPwmAggregateRecord.payload.model,
  "canonical-pwm-aggregate-record-v1",
);
assert.deepEqual(
  rawPwmAggregateRecord.rawRecordParts.map(
    ({ protocolVout }) => protocolVout,
  ),
  [1, 2],
);
assert.equal(
  rawPwmAggregateRecord.message,
  `${rawPwmAggregateSubject}\n${rawPwmAggregateMemo}`,
);
const rawPwmAggregateReplay =
  replayRawAdversarialRecords([rawPwmAggregateRecord]);
assert.equal(
  rawPwmAggregateReplay.outcomes.get(
    `${rawPwmAggregateTxid}:1:0`,
  )?.valid,
  true,
);
assert.equal(
  rawPwmAggregateReplay.genericState.holders.find(
    ({ address, tokenId }) =>
      address === rawAdversarialActor &&
      tokenId === WORK_AMO_V5_POWB_TOKEN_ID,
  )?.balance,
  "77",
);

const rawPwmOrderTamper = structuredClone(
  rawPwmAggregateRecord,
);
rawPwmOrderTamper.rawRecordParts.reverse();
rawPwmOrderTamper.payload.rawRecordParts.reverse();
rawPwmOrderTamper.message = [
  rawPwmAggregateMemo,
  rawPwmAggregateSubject,
].join("\n");
assert.throws(
  () => replayRawAdversarialRecords([rawPwmOrderTamper]),
  /work-amo-v5-raw-record-transaction-witness-mismatch/u,
);

const rawPwmSplitFirst = structuredClone(
  rawPwmAggregateRecord,
);
const rawPwmSplitSecond = structuredClone(
  rawPwmAggregateRecord,
);
for (const splitRecord of [
  rawPwmSplitFirst,
  rawPwmSplitSecond,
]) {
  splitRecord.transactionProtocolRecordCount = 2;
}
rawPwmSplitFirst.message =
  rawPwmAggregateRecord.rawRecordParts[0].text;
rawPwmSplitFirst.rawRecordParts = [
  structuredClone(rawPwmAggregateRecord.rawRecordParts[0]),
];
rawPwmSplitFirst.payload = {
  model: "canonical-raw-protocol-record-v1",
  rawRecordParts: structuredClone(
    rawPwmSplitFirst.rawRecordParts,
  ),
};
rawPwmSplitSecond.message =
  rawPwmAggregateRecord.rawRecordParts[1].text;
rawPwmSplitSecond.position.protocolVout = 2;
rawPwmSplitSecond.protocolVout = 2;
rawPwmSplitSecond.rawRecordParts = [
  structuredClone(rawPwmAggregateRecord.rawRecordParts[1]),
];
rawPwmSplitSecond.payload = {
  model: "canonical-raw-protocol-record-v1",
  rawRecordParts: structuredClone(
    rawPwmSplitSecond.rawRecordParts,
  ),
};
assert.throws(
  () =>
    replayRawAdversarialRecords([
      rawPwmSplitFirst,
      rawPwmSplitSecond,
    ]),
  /work-amo-v5-raw-transaction-record-set-mismatch/u,
);

let rawPwmStraddleTxid = "";
const rawPwmStraddleMint =
  `pwt1:mint:${rawAdversarialGenericTokenId}:1`;
const rawPwmStraddleTx = {
  vin: [
    {
      prevout: {
        scriptpubkey_address: rawAdversarialActor,
      },
      txid: hash("8"),
      vout: 1,
    },
  ],
  vout: [
    {
      scriptpubkey_address: rawAdversarialGenericRegistry,
      value: 546,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript("pwm1:m:inc"),
      value: 0,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript(rawPwmStraddleMint),
      value: 0,
    },
    {
      scriptpubkey:
        rawAdversarialOpReturnScript("pwm1:m:b"),
      value: 0,
    },
  ],
};
rawPwmStraddleTxid =
  rawAdversarialHydratedTransaction({
    feeSats: 41,
    tx: rawPwmStraddleTx,
  }).txid;
const rawPwmStraddleRecords = [1, 2].map(
  (protocolVout) =>
    rawAdversarialRecord({
      blockHash: rawAdversarialBlockHash,
      blockHeight: rawAdversarialBlockHeight,
      blockTransactionIndex: 9,
      feeSats: 41,
      protocolVout,
      tx: rawPwmStraddleTx,
      txid: rawPwmStraddleTxid,
    }),
);
const rawPwmStraddleReplay =
  replayRawAdversarialRecords(rawPwmStraddleRecords);
const rawPwmStraddleOutcome =
  rawPwmStraddleReplay.outcomes.get(
    `${rawPwmStraddleTxid}:1:0`,
  );
const rawPwmStraddleMintOutcome =
  rawPwmStraddleReplay.outcomes.get(
    `${rawPwmStraddleTxid}:2:0`,
  );
assert.equal(rawPwmStraddleOutcome?.valid, false);
assert.equal(
  rawPwmStraddleOutcome?.reasonCode,
  CANONICAL_PWM_ENVELOPE_NONCONTIGUOUS,
);
assert.equal(rawPwmStraddleMintOutcome?.valid, true);
assert.equal(
  rawPwmStraddleReplay.genericState.tokens.find(
    ({ tokenId }) => tokenId === WORK_AMO_V5_INCB_TOKEN_ID,
  )?.confirmedSupplyAtoms,
  "0",
);
assert.equal(
  rawPwmStraddleReplay.genericState.holders.find(
    ({ tokenId }) => tokenId === WORK_AMO_V5_INCB_TOKEN_ID,
  ),
  undefined,
);
assert.equal(
  rawPwmStraddleReplay.genericState.holders.find(
    ({ address, tokenId }) =>
      address === rawAdversarialActor &&
      tokenId === rawAdversarialGenericTokenId,
  )?.balance,
  "1",
);

const rawOrderMutationRecords =
  structuredClone(rawAdversarialRecords);
for (const record of rawOrderMutationRecords) {
  if (record.txid === rawAdversarialInvalidOnlyATxid) {
    record.position.blockTransactionIndex = 6;
  } else if (record.txid === rawAdversarialInvalidOnlyBTxid) {
    record.position.blockTransactionIndex = 5;
  }
}
const rawOrderMutationReplay =
  replayRawAdversarialRecords(rawOrderMutationRecords);
assertRawAdversarialLogicalStateEqual(
  rawAdversarialReplay,
  rawOrderMutationReplay,
);
assert.notDeepEqual(
  rawAdversarialReplay.stateCommitment,
  rawOrderMutationReplay.stateCommitment,
);
assert.notDeepEqual(
  rawAdversarialReplay.transitionChainCommitment,
  rawOrderMutationReplay.transitionChainCommitment,
);

const rawMissingOrdinalRecord = structuredClone(
  rawAdversarialRecords.find(
    ({ txid }) => txid === rawAdversarialInvalidOnlyATxid,
  ),
);
delete rawMissingOrdinalRecord.position.recordOrdinal;
assert.throws(
  () => replayRawAdversarialRecords([rawMissingOrdinalRecord]),
  /work-amo-v5-raw-record-invalid/u,
);

const canonicalCatchUpError = new MarketplaceRegressionHttpError(
  "https://computer.proofofwork.me/api/v1/token",
  503,
  {
    details: { code: "CANONICAL_INDEX_CATCHING_UP" },
    error:
      "The canonical ProofOfWork index is catching up to the Bitcoin Core tip.",
  },
);
assert.equal(isRetryableCanonicalReadError(canonicalCatchUpError), true);
assert.equal(
  isRetryableCanonicalReadError(
    new MarketplaceRegressionHttpError(
      "https://computer.proofofwork.me/api/v1/token",
      503,
      {
        details: { code: "CANONICAL_WALLET_INDEX_UNAVAILABLE" },
        error:
          "Fresh wallet credit state is temporarily unavailable for WORK.",
      },
    ),
  ),
  true,
);

const canonicalHashA = "a".repeat(64);
const canonicalHashB = "b".repeat(64);
const transientIndexUnavailableDetails = {
  canonicalHash: canonicalHashA,
  fault: { active: false },
  indexedThroughBlock: 100,
  lagBlocks: 1,
  readModelsOk: true,
  rebuild: {
    active: false,
    complete: true,
    status: "complete",
  },
  storedHash: canonicalHashA,
  tipHeight: 101,
};
assert.equal(
  isRetryableCanonicalReadError(
    new MarketplaceRegressionHttpError(
      "https://computer.proofofwork.me/api/v1/token",
      503,
      {
        details: {
          code: "CANONICAL_INDEX_UNAVAILABLE",
          ...transientIndexUnavailableDetails,
        },
        error:
          "The canonical ProofOfWork index is rebuilding or no longer matches Bitcoin Core.",
      },
    ),
  ),
  true,
);
assert.equal(
  isRetryableCanonicalReadError(
    new MarketplaceRegressionHttpError(
      "https://computer.proofofwork.me/api/v1/token",
      503,
      {
        details: {
          code: "CANONICAL_INDEX_UNAVAILABLE",
          ...transientIndexUnavailableDetails,
          fault: { active: true },
        },
        error:
          "The canonical ProofOfWork index is rebuilding or no longer matches Bitcoin Core.",
      },
    ),
  ),
  false,
);
assert.equal(
  isRetryableCanonicalReadError(
    new MarketplaceRegressionHttpError(
      "https://computer.proofofwork.me/api/v1/token",
      503,
      {
        details: {
          code: "CANONICAL_INDEX_UNAVAILABLE",
          ...transientIndexUnavailableDetails,
          canonicalHash: canonicalHashB,
        },
        error:
          "The canonical ProofOfWork index is rebuilding or no longer matches Bitcoin Core.",
      },
    ),
  ),
  false,
);
assert.equal(
  isRetryableCanonicalReadError(
    new MarketplaceRegressionHttpError(
      "https://computer.proofofwork.me/api/v1/token",
      503,
      {
        error: "Fresh credit state is still catching up for WORK.",
      },
    ),
  ),
  true,
);
assert.equal(
  isRetryableCanonicalReadError(
    new MarketplaceRegressionHttpError(
      "https://computer.proofofwork.me/api/v1/token",
      503,
      {
        details: { code: "CANONICAL_SUMMARY_INCOHERENT" },
        error: "A generic parser or summary invariant failed.",
      },
    ),
  ),
  false,
);
assert.equal(
  isRetryableCanonicalReadError(
    new MarketplaceRegressionHttpError(
      "https://computer.proofofwork.me/api/v1/token",
      500,
      {
        details: { code: "CANONICAL_INDEX_CATCHING_UP" },
        error: "Unexpected server error.",
      },
    ),
  ),
  false,
);

const expectedWorkAmoV5TipRaceStatus = {
  activationHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
  allowedFaceUsdCents: WORK_AMO_V5_ALLOWED_FACE_USD_CENTS,
  authVersion: WORK_AMO_V5_AUTH_VERSION,
  declarationBlockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
  declarationBlockIndex: WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
  declarationHeight: WORK_AMO_V5_DECLARATION_HEIGHT,
  declarationTxid: WORK_AMO_V5_DECLARATION_TXID,
  maxQuoteAgeBlocks: WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
  models: WORK_AMO_V5_MODELS,
};
const canonicalNotReadyStatus = workAmoV5StatusFromEvidence(
  declarationEvidence,
  {
    indexReady: false,
    quoteHead: null,
    tipHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    writesConfigured: false,
  },
);
const canonicalReadyStatus = workAmoV5StatusFromEvidence(
  declarationEvidence,
  {
    indexReady: true,
    quoteHead: null,
    tipHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    writesConfigured: false,
  },
);
assert.equal(
  isRetryableWorkAmoV5TipRaceStatus(
    canonicalNotReadyStatus,
    expectedWorkAmoV5TipRaceStatus,
  ),
  true,
);
assert.equal(
  isRetryableWorkAmoV5TipRaceStatus(
    {
      ...canonicalNotReadyStatus,
      models: {
        ...canonicalNotReadyStatus.models,
        unitModel: "unexpected-unit-model",
      },
    },
    expectedWorkAmoV5TipRaceStatus,
  ),
  false,
);
assert.equal(
  marketplaceRegressionCanonicalReadKind({
    params: {
      asset: WORK_TOKEN_ID,
      fresh: 1,
      network: "livenet",
    },
    path: "/api/v1/token",
    workTokenId: WORK_TOKEN_ID,
  }),
  "work-token",
);
for (const path of [
  "/api/v1/token-history",
  "/api/v1/token-summary",
  "/api/v1/work-summary",
  "/api/v1/marketplace-summary",
  "/api/v1/growth-summary",
]) {
  assert.equal(
    marketplaceRegressionCanonicalReadKind({
      params: {
        asset: WORK_TOKEN_ID,
        fresh: 1,
        network: "livenet",
      },
      path,
      workTokenId: WORK_TOKEN_ID,
    }),
    "canonical",
    `${path} must share the bounded canonical convergence budget`,
  );
}
assert.equal(
  marketplaceRegressionCanonicalReadKind({
    params: {
      asset: WORK_TOKEN_ID,
      network: "livenet",
    },
    path: "/api/v1/token",
    workTokenId: WORK_TOKEN_ID,
  }),
  "",
);
assert.equal(
  marketplaceRegressionCanonicalReadKind({
    params: {
      asset: WORK_TOKEN_ID,
      fresh: 1,
      network: "livenet",
    },
    path: "/api/v1/tx/example/status",
    workTokenId: WORK_TOKEN_ID,
  }),
  "",
);

let convergenceClockMs = 0;
let initialTokenReads = 0;
const sharedConvergenceBudget = createCanonicalConvergenceBudget(25);
const convergedInitialToken =
  await waitForCanonicalConvergenceWithinBudget({
    budget: sharedConvergenceBudget,
    isReady: (payload) => payload?.workAmoV5?.indexReady === true,
    isRetryableValue: (payload) =>
      isRetryableWorkAmoV5TipRaceStatus(
        payload?.workAmoV5,
        expectedWorkAmoV5TipRaceStatus,
      ),
    label: "initial Marketplace V2 WORK token convergence",
    now: () => convergenceClockMs,
    pollIntervalMs: 10,
    read: async () => {
      initialTokenReads += 1;
      if (initialTokenReads === 1) {
        throw canonicalCatchUpError;
      }
      return {
        workAmoV5:
          initialTokenReads === 2
            ? canonicalNotReadyStatus
            : canonicalReadyStatus,
      };
    },
    sleep: async (delayMs) => {
      convergenceClockMs += delayMs;
    },
  });
assert.equal(convergedInitialToken.workAmoV5.indexReady, true);
assert.equal(initialTokenReads, 3);
assert.equal(convergenceClockMs, 20);
assert.equal(sharedConvergenceBudget.remainingMs, 5);

let laterHistoryReads = 0;
const convergedLaterHistory =
  await waitForCanonicalConvergenceWithinBudget({
    budget: sharedConvergenceBudget,
    isReady: () => true,
    isRetryableValue: () => false,
    label: "later fresh WORK history convergence",
    now: () => convergenceClockMs,
    pollIntervalMs: 2,
    read: async () => {
      laterHistoryReads += 1;
      if (laterHistoryReads === 1) {
        throw canonicalCatchUpError;
      }
      return { items: [] };
    },
    sleep: async (delayMs) => {
      convergenceClockMs += delayMs;
    },
  });
assert.deepEqual(convergedLaterHistory.items, []);
assert.equal(laterHistoryReads, 2);
assert.equal(convergenceClockMs, 22);
assert.equal(sharedConvergenceBudget.remainingMs, 3);

let readyAfterDeadlineClockMs = 0;
let readyAfterDeadlineReads = 0;
await assert.rejects(
  waitForCanonicalConvergence({
    isReady: (payload) => payload?.ready === true,
    isRetryableValue: () => false,
    label: "ready after canonical convergence deadline",
    maxWaitMs: 25,
    now: () => readyAfterDeadlineClockMs,
    pollIntervalMs: 10,
    read: async () => {
      readyAfterDeadlineReads += 1;
      readyAfterDeadlineClockMs = 25;
      return { ready: true };
    },
    sleep: async () => {
      throw new Error("an expired ready read must not sleep");
    },
  }),
  (error) =>
    error instanceof CanonicalConvergenceTimeoutError &&
    error.maxWaitMs === 25,
);
assert.equal(readyAfterDeadlineReads, 1);

let genericFailureReads = 0;
const genericFailure = new MarketplaceRegressionHttpError(
  "https://computer.proofofwork.me/api/v1/token",
  503,
  {
    details: { code: "CANONICAL_SUMMARY_INCOHERENT" },
    error: "A generic parser or summary invariant failed.",
  },
);
await assert.rejects(
  waitForCanonicalConvergence({
    isReady: () => false,
    isRetryableValue: () => false,
    label: "generic server failure",
    maxWaitMs: 25,
    now: () => 0,
    pollIntervalMs: 10,
    read: async () => {
      genericFailureReads += 1;
      throw genericFailure;
    },
    sleep: async () => {
      throw new Error("generic failures must not sleep");
    },
  }),
  (error) => error === genericFailure,
);
assert.equal(genericFailureReads, 1);

convergenceClockMs = 0;
let boundedConvergenceReads = 0;
const boundedSleepDelays = [];
await assert.rejects(
  waitForCanonicalConvergence({
    isReady: () => false,
    isRetryableValue: () => true,
    label: "bounded canonical convergence",
    maxWaitMs: 25,
    now: () => convergenceClockMs,
    pollIntervalMs: 10,
    read: async () => {
      boundedConvergenceReads += 1;
      return { ready: false };
    },
    sleep: async (delayMs) => {
      boundedSleepDelays.push(delayMs);
      convergenceClockMs += delayMs;
    },
  }),
  (error) =>
    error instanceof CanonicalConvergenceTimeoutError &&
    error.maxWaitMs === 25,
);
assert.equal(convergenceClockMs, 25);
assert.equal(boundedConvergenceReads, 3);
assert.deepEqual(boundedSleepDelays, [10, 10, 5]);

console.log("WORK AMO V5 checks passed.");
