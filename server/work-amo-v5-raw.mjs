import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import {
  CANONICAL_OP_RETURN_SCRIPT_MALFORMED,
  CANONICAL_OP_RETURN_UTF8_INVALID,
  CANONICAL_PWM_ENVELOPE_NONCONTIGUOUS,
  canonicalRawProtocolRecordSetFromTransaction,
} from "./canonical-op-return.mjs";
import {
  assertCanonicalUnicodeCaseMappingVersion,
} from "./canonical-order.mjs";
import {
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_ATOMS_PER_WORK,
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_ID_REGISTRY_ADDRESS,
  WORK_AMO_V5_INCB_TOKEN_ID,
  WORK_AMO_V5_LISTING_ANCHOR_VALUE_SATS,
  WORK_AMO_V5_LISTING_ANCHOR_VOUT,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  WORK_AMO_V5_POWB_TOKEN_ID,
  WORK_AMO_V5_RUSH_REGISTRY_ADDRESS,
  WORK_AMO_V5_TOKEN_INDEX_ADDRESS,
  WORK_AMO_V4_AUTH_VERSION,
  assignWorkAmoV5EconomicOutputs,
  compareWorkAmoUtf8,
  deriveWorkAmoV5FrozenTerms,
  isWorkAmoV5LivenetAddress,
  parseWorkAmoUsdQuoteRecord,
  parseWorkAmoV5GenericSaleAuthorization,
  parseWorkAmoV5IdSaleAuthorization,
  parseWorkAmoV5PwmMessages,
  parseWorkAmoV5RawPwidRecord,
  parseWorkAmoV5RawPwrRecord,
  parseWorkAmoV5RawPwtRecord,
  selectWorkAmoV5DistinctRegistryPayment,
  validateWorkAmoUsdQuoteEvidence,
  validateWorkAmoV5ReferencedAuthorization,
  validateWorkAmoV5SaleTicketSignature,
  validateWorkAmoV5SealOrBuyTerms,
  validateWorkAmoV5StaticAuthorization,
  validateWorkAmoV5SufficientState,
  workAmoV5CanonicalExpiryMs,
  workAmoCanonicalPositionPrecedes,
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5CanonicalStateCommitment,
  workAmoV5CanonicalTokenStateCommitment,
  workAmoV5CanonicalTokenStatePreimage,
  workAmoV5GenericSaleAuthorizationsMatch,
  workAmoV5IdSaleAuthorizationsMatch,
} from "./work-amo-v5.mjs";
import {
  WORK_TOKEN_ID,
  parseWorkAmountToAtoms,
  workAmountAtomsFromRecord,
} from "./work-units.mjs";

const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const WORK_AMO_V5_MIN_PAYMENT_SATS =
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS;
const WORK_AMO_V5_WORK_MINT_PAYMENT_SATS = 1_000;
const WORK_AMO_V5_RESERVED_TOKEN_IDS = new Set([
  WORK_TOKEN_ID,
  WORK_AMO_V5_POWB_TOKEN_ID,
  WORK_AMO_V5_INCB_TOKEN_ID,
]);
const WORK_AMO_VALUE_Q8_SCALE = 100_000_000n;
const WORK_AMO_V5_MOVEMENT_DENOMINATOR =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK;
const WORK_AMO_V5_GROWTH_VALUE_MULTIPLE = 5n;
const WORK_AMO_V5_ID_DENSITY_NUMERATOR = 26_868_933_906_745_133n;
const WORK_AMO_V5_ID_DENSITY_DENOMINATOR = 100_000_000_000_000n;
export const WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL =
  "canonical-work-amo-raw-transition-chain-sha256-v1";
export const WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL =
  "canonical-work-amo-raw-full-block-descriptor-v1";
export const WORK_AMO_V5_RAW_TRANSACTION_WITNESS_MODEL =
  "canonical-work-amo-raw-transaction-witness-v1";
export const WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL =
  "canonical-work-amo-raw-bip141-witness-v1";
const OVERLAY_DELETED = Symbol("work-amo-v5-overlay-deleted");

class OverlayMap {
  constructor(base) {
    if (!(base instanceof Map)) {
      throw new TypeError("work-amo-v5-overlay-base-invalid");
    }
    this.base = base;
    this.changes = new Map();
  }

  get size() {
    let size = this.base.size;
    for (const [key, value] of this.changes) {
      if (value === OVERLAY_DELETED) {
        if (this.base.has(key)) {
          size -= 1;
        }
      } else if (!this.base.has(key)) {
        size += 1;
      }
    }
    return size;
  }

  clear() {
    for (const key of this.base.keys()) {
      this.changes.set(key, OVERLAY_DELETED);
    }
    for (const [key, value] of this.changes) {
      if (value !== OVERLAY_DELETED && !this.base.has(key)) {
        this.changes.set(key, OVERLAY_DELETED);
      }
    }
  }

  delete(key) {
    const existed = this.has(key);
    this.changes.set(key, OVERLAY_DELETED);
    return existed;
  }

  *entries() {
    for (const [key, value] of this.base) {
      if (!this.changes.has(key)) {
        yield [key, value];
      }
    }
    for (const [key, value] of this.changes) {
      if (value !== OVERLAY_DELETED) {
        yield [key, value];
      }
    }
  }

  forEach(callback, thisArg) {
    for (const [key, value] of this) {
      callback.call(thisArg, value, key, this);
    }
  }

  get(key) {
    if (this.changes.has(key)) {
      const value = this.changes.get(key);
      return value === OVERLAY_DELETED ? undefined : value;
    }
    return this.base.get(key);
  }

  has(key) {
    if (this.changes.has(key)) {
      return this.changes.get(key) !== OVERLAY_DELETED;
    }
    return this.base.has(key);
  }

  *keys() {
    for (const [key] of this) {
      yield key;
    }
  }

  set(key, value) {
    this.changes.set(key, value);
    return this;
  }

  *values() {
    for (const [, value] of this) {
      yield value;
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

function exactUnsignedText(value, { positive = false } = {}) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return "";
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return "";
  }
  const text = String(value).trim();
  if (!INTEGER_PATTERN.test(text) || (positive && text === "0")) {
    return "";
  }
  return BigInt(text).toString();
}

function exactSafeInteger(value, { positive = false } = {}) {
  const text = exactUnsignedText(value, { positive });
  if (!text || BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(text);
}

function projectionValue(value, seen = new Set()) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => projectionValue(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError(
        "work-amo-v5-raw-projection-cycle-invalid",
      );
    }
    seen.add(value);
    const projected = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = projectionValue(item, seen);
      if (normalized !== undefined) {
        Object.defineProperty(projected, key, {
          configurable: true,
          enumerable: true,
          value: normalized,
          writable: true,
        });
      }
    }
    seen.delete(value);
    return projected;
  }
  throw new TypeError("work-amo-v5-raw-projection-value-invalid");
}

function normalizedTxid(value) {
  const txid = String(value ?? "").trim().toLowerCase();
  return TXID_PATTERN.test(txid) ? txid : "";
}

function normalizedId(value) {
  assertCanonicalUnicodeCaseMappingVersion();
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "")
    .trim();
}

function normalizedPosition(value) {
  const source = value?.position ?? value;
  const blockHash = normalizedTxid(source?.blockHash);
  const blockHeight = exactSafeInteger(source?.blockHeight, {
    positive: true,
  });
  const blockTransactionIndex = exactSafeInteger(
    source?.blockTransactionIndex ?? source?.blockIndex,
  );
  const protocolVout = exactSafeInteger(
    source?.protocolVout ?? source?.opReturnVout,
  );
  const recordOrdinal = exactSafeInteger(source?.recordOrdinal);
  return blockHash &&
    blockHeight !== null &&
    blockTransactionIndex !== null &&
    protocolVout !== null &&
    recordOrdinal !== null
    ? {
        blockHash,
        blockHeight,
        blockTransactionIndex,
        protocolVout,
        recordOrdinal,
      }
    : null;
}

function comparePositions(left, right) {
  for (const field of [
    "blockHeight",
    "blockTransactionIndex",
    "protocolVout",
    "recordOrdinal",
  ]) {
    const difference = Number(left?.[field]) - Number(right?.[field]);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function recordKey(record) {
  return [
    normalizedTxid(record?.txid),
    Number(record?.position?.protocolVout),
    Number(record?.position?.recordOrdinal),
  ].join(":");
}

function canonicalPositionKey(position) {
  return [
    Number(position?.blockHeight),
    Number(position?.blockTransactionIndex),
    Number(position?.protocolVout),
    Number(position?.recordOrdinal),
  ].join(":");
}

function outputAddress(output) {
  const scriptPubKeyHex = exactTransactionOutputScript(output);
  return scriptPubKeyHex
    ? canonicalScriptAddress(scriptPubKeyHex)
    : "";
}

function outputScript(output) {
  return exactTransactionOutputScript(output) ?? "";
}

function outputSats(output) {
  return exactSafeInteger(
    output?.value ?? output?.amountSats ?? output?.outputSats,
    { positive: true },
  );
}

function rawOutputs(record) {
  return (Array.isArray(record?.tx?.vout) ? record.tx.vout : []).flatMap(
    (output, vout) => {
      const address = outputAddress(output);
      const amountSats = outputSats(output);
      return address && amountSats !== null
        ? [{
            address,
            amountSats,
            outputSats: amountSats,
            scriptPubKeyHex: outputScript(output),
            vout,
          }]
        : [];
    },
  );
}

function inputAddresses(record) {
  return [
    ...new Set(
      (Array.isArray(record?.tx?.vin) ? record.tx.vin : [])
        .map((input) => outputAddress(input?.prevout))
        .filter(Boolean),
    ),
  ];
}

function firstAddressBearingInput(record) {
  return inputAddresses(record)[0] ?? "";
}

function firstInputScript(record) {
  return outputScript(record?.tx?.vin?.[0]?.prevout);
}

function transactionSpends(record, txid, vout) {
  const targetTxid = normalizedTxid(txid);
  const targetVout = exactSafeInteger(vout);
  return Boolean(
    targetTxid &&
      targetVout !== null &&
      (Array.isArray(record?.tx?.vin) ? record.tx.vin : []).some(
        (input) =>
          normalizedTxid(input?.txid) === targetTxid &&
          Number(input?.vout) === targetVout,
      ),
  );
}

function rawOutputAt(record, vout) {
  const index = exactSafeInteger(vout);
  const output =
    index === null || !Array.isArray(record?.tx?.vout)
      ? null
      : record.tx.vout[index];
  const amountSats = outputSats(output);
  return output && amountSats !== null
    ? {
        address: outputAddress(output),
        amountSats,
        outputSats: amountSats,
        scriptPubKeyHex: outputScript(output),
        vout: index,
      }
    : null;
}

function emptyStateDelta() {
  return {
    baseContributions: [],
    creditFixedQ8: "0",
    creditFixedSats: "0",
    economicOutputs: [],
  };
}

function invalidOutcome(reasonCode, parsed = null, semanticKind = "") {
  return {
    derived: [],
    output: null,
    parsed,
    reasonCode,
    semanticKind: semanticKind || "protocol-event-invalid",
    stateDelta: emptyStateDelta(),
    valid: false,
  };
}

function balanceKey(tokenId, address) {
  return `${tokenId}\x00${address}`;
}

function normalizeDefinition(source) {
  const tokenId = normalizedTxid(source?.tokenId);
  const ticker = String(source?.ticker ?? "").trim().toUpperCase();
  const maxSupplySource = source?.maxSupply;
  const maxSupply =
    maxSupplySource === null || maxSupplySource === undefined
      ? null
      : exactUnsignedText(maxSupplySource, { positive: true });
  const mintAmount = exactUnsignedText(source?.mintAmount ?? 1, {
    positive: true,
  });
  const mintPriceSats = exactUnsignedText(source?.mintPriceSats ?? 1, {
    positive: true,
  });
  const registryAddress = String(source?.registryAddress ?? "").trim();
  if (
    !tokenId ||
    tokenId === WORK_TOKEN_ID ||
    !/^[A-Z0-9]{1,12}$/u.test(ticker) ||
    (maxSupplySource !== null &&
      maxSupplySource !== undefined &&
      !maxSupply) ||
    !mintAmount ||
    !mintPriceSats ||
    !isWorkAmoV5LivenetAddress(registryAddress)
  ) {
    return null;
  }
  return {
    maxSupply,
    mintAmount,
    mintPriceSats,
    registryAddress,
    ticker,
    tokenId,
  };
}

function genericStateFromProjection(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const definitions = new Map();
  for (const candidate of [
    ...(Array.isArray(source.tokens) ? source.tokens : []),
    ...(Array.isArray(source.definitions) ? source.definitions : []),
  ]) {
    const definition = normalizeDefinition(candidate);
    if (definition && !definitions.has(definition.tokenId)) {
      definitions.set(definition.tokenId, definition);
    }
  }
  const balances = new Map();
  for (const holder of Array.isArray(source.holders) ? source.holders : []) {
    const tokenId = normalizedTxid(holder?.tokenId);
    const address = String(holder?.address ?? "").trim();
    const balance = exactUnsignedText(
      holder?.balanceAtoms ?? holder?.balance ?? 0,
    );
    if (
      !tokenId ||
      tokenId === WORK_TOKEN_ID ||
      !definitions.has(tokenId) ||
      !isWorkAmoV5LivenetAddress(address) ||
      !balance
    ) {
      continue;
    }
    const key = balanceKey(tokenId, address);
    balances.set(key, (balances.get(key) ?? 0n) + BigInt(balance));
  }
  const supply = new Map();
  for (const [key, balance] of balances) {
    const tokenId = key.split("\x00", 1)[0];
    supply.set(tokenId, (supply.get(tokenId) ?? 0n) + balance);
  }
  for (const token of Array.isArray(source.tokens) ? source.tokens : []) {
    const tokenId = normalizedTxid(token?.tokenId);
    const statedSupply = exactUnsignedText(
      token?.confirmedSupplyAtoms ?? token?.confirmedSupply,
    );
    if (
      tokenId &&
      definitions.has(tokenId) &&
      statedSupply &&
      BigInt(statedSupply) === (supply.get(tokenId) ?? 0n)
    ) {
      supply.set(tokenId, BigInt(statedSupply));
    }
  }
  const listings = new Map();
  for (const listing of Array.isArray(source.listings)
    ? source.listings
    : []) {
    const listingId = normalizedTxid(
      listing?.listingId ?? listing?.txid,
    );
    const tokenId = normalizedTxid(
      listing?.tokenId ?? listing?.saleAuthorization?.tokenId,
    );
    const amount = exactUnsignedText(
      listing?.amountAtoms ?? listing?.amount,
      { positive: true },
    );
    const priceSats = exactUnsignedText(listing?.priceSats, {
      positive: true,
    });
    const sellerAddress = String(listing?.sellerAddress ?? "").trim();
    if (
      !listingId ||
      !tokenId ||
      tokenId === WORK_TOKEN_ID ||
      !definitions.has(tokenId) ||
      !amount ||
      !priceSats ||
      !isWorkAmoV5LivenetAddress(sellerAddress) ||
      !listing?.saleAuthorization
    ) {
      continue;
    }
    listings.set(listingId, {
      amount: BigInt(amount),
      listingId,
      priceSats: BigInt(priceSats),
      saleAuthorization: structuredClone(listing.saleAuthorization),
      sellerAddress,
      tokenId,
    });
  }
  const reserved = new Map();
  for (const listing of listings.values()) {
    const key = balanceKey(
      listing.tokenId,
      listing.sellerAddress,
    );
    reserved.set(key, (reserved.get(key) ?? 0n) + listing.amount);
  }
  return { balances, definitions, listings, reserved, supply };
}

function genericProjectionFromState(state) {
  const tokens = [...state.definitions.values()]
    .map((definition) => ({
      ...definition,
      confirmedSupplyAtoms:
        (state.supply.get(definition.tokenId) ?? 0n).toString(),
    }))
    .sort((left, right) =>
      compareWorkAmoUtf8(left.tokenId, right.tokenId),
    );
  const holders = [...state.balances]
    .flatMap(([key, balance]) => {
      if (balance === 0n) {
        return [];
      }
      const [tokenId, address] = key.split("\x00");
      return [{ address, balance: balance.toString(), tokenId }];
    })
    .sort(
      (left, right) =>
        compareWorkAmoUtf8(left.tokenId, right.tokenId) ||
        compareWorkAmoUtf8(left.address, right.address),
    );
  const listings = [...state.listings.values()]
    .map((listing) => ({
      amount: listing.amount.toString(),
      listingId: listing.listingId,
      priceSats: listing.priceSats.toString(),
      saleAuthorization: structuredClone(listing.saleAuthorization),
      sellerAddress: listing.sellerAddress,
      tokenId: listing.tokenId,
    }))
    .sort((left, right) =>
      compareWorkAmoUtf8(left.listingId, right.listingId),
    );
  return {
    holders,
    listings,
    model: "canonical-work-amo-v5-generic-token-state-v1",
    tokens,
  };
}

export function normalizeWorkAmoV5RawGenericState(value) {
  return genericProjectionFromState(genericStateFromProjection(value));
}

function workStateFromProjection(value) {
  const preimage = workAmoV5CanonicalTokenStatePreimage(value);
  const listings = new Map(
    preimage.listings.map((listing) => [
      listing.listingId,
      {
        amountAtoms: BigInt(listing.amountAtoms),
        frozenTerms: structuredClone(listing.frozenTerms),
        listingId: listing.listingId,
        priceSats: BigInt(listing.priceSats),
        saleAuthorization: structuredClone(listing.saleAuthorization),
        sellerAddress: listing.sellerAddress,
      },
    ]),
  );
  const reserved = new Map();
  for (const listing of listings.values()) {
    reserved.set(
      listing.sellerAddress,
      (reserved.get(listing.sellerAddress) ?? 0n) +
        listing.amountAtoms,
    );
  }
  return {
    balances: new Map(
      preimage.holders.map((holder) => [
        holder.address,
        BigInt(holder.balanceAtoms),
      ]),
    ),
    confirmedSupplyAtoms: BigInt(preimage.confirmedSupplyAtoms),
    listings,
    reserved,
  };
}

function workProjectionFromState(state) {
  return {
    confirmedSupplyAtoms: state.confirmedSupplyAtoms.toString(),
    holders: [...state.balances]
      .flatMap(([address, balanceAtoms]) =>
        balanceAtoms === 0n ? [] : [{ address, balanceAtoms: balanceAtoms.toString() }],
      )
      .sort((left, right) =>
        compareWorkAmoUtf8(left.address, right.address),
      ),
    listings: [...state.listings.values()]
      .map((listing) => ({
        amountAtoms: listing.amountAtoms.toString(),
        frozenTerms: structuredClone(listing.frozenTerms),
        listingId: listing.listingId,
        priceSats: listing.priceSats.toString(),
        saleAuthorization: structuredClone(listing.saleAuthorization),
        sellerAddress: listing.sellerAddress,
      }))
      .sort((left, right) =>
        compareWorkAmoUtf8(left.listingId, right.listingId),
      ),
  };
}

export function normalizeWorkAmoV5RawWorkState(value) {
  return workProjectionFromState(workStateFromProjection(value));
}

function idStateFromProjection(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const records = new Map();
  for (const record of Array.isArray(source.records) ? source.records : []) {
    const id = normalizedId(record?.id);
    const ownerAddress = String(record?.ownerAddress ?? "").trim();
    const receiveAddress = String(
      record?.receiveAddress ?? ownerAddress,
    ).trim();
    if (
      record?.confirmed === false ||
      !id ||
      !isWorkAmoV5LivenetAddress(ownerAddress) ||
      !isWorkAmoV5LivenetAddress(receiveAddress) ||
      records.has(id)
    ) {
      continue;
    }
    records.set(id, {
      id,
      ownerAddress,
      pgpKey: String(record?.pgpKey ?? ""),
      receiveAddress,
    });
  }
  const listings = new Map();
  for (const listing of Array.isArray(source.listings)
    ? source.listings
    : []) {
    const listingId = normalizedTxid(listing?.listingId);
    const id = normalizedId(
      listing?.id ?? listing?.saleAuthorization?.id,
    );
    const sellerAddress = String(listing?.sellerAddress ?? "").trim();
    const priceSats = exactUnsignedText(listing?.priceSats, {
      positive: true,
    });
    if (
      !listingId ||
      !id ||
      !records.has(id) ||
      !isWorkAmoV5LivenetAddress(sellerAddress) ||
      !priceSats ||
      !listing?.saleAuthorization
    ) {
      continue;
    }
    listings.set(listingId, {
      id,
      listingId,
      priceSats: BigInt(priceSats),
      saleAuthorization: structuredClone(listing.saleAuthorization),
      sellerAddress,
    });
  }
  const listingIdsById = new Map();
  for (const listing of listings.values()) {
    const listingIds = listingIdsById.get(listing.id) ?? new Set();
    listingIds.add(listing.listingId);
    listingIdsById.set(listing.id, listingIds);
  }
  return { listingIdsById, listings, records };
}

function idProjectionFromState(state) {
  return {
    listings: [...state.listings.values()]
      .map((listing) => ({
        ...listing,
        priceSats: listing.priceSats.toString(),
        saleAuthorization: structuredClone(listing.saleAuthorization),
      }))
      .sort((left, right) =>
        compareWorkAmoUtf8(left.listingId, right.listingId),
      ),
    model: "canonical-work-amo-v5-id-state-v1",
    records: [...state.records.values()]
      .map((record) => ({ ...record }))
      .sort((left, right) =>
        compareWorkAmoUtf8(left.id, right.id),
      ),
  };
}

export function normalizeWorkAmoV5RawIdState(value) {
  return idProjectionFromState(idStateFromProjection(value));
}

export function workAmoV5RawGenericStateCommitment(value) {
  return workAmoV5CanonicalPayloadCommitment(
    normalizeWorkAmoV5RawGenericState(value),
  );
}

export function workAmoV5RawIdStateCommitment(value) {
  return workAmoV5CanonicalPayloadCommitment(
    normalizeWorkAmoV5RawIdState(value),
  );
}

function commitmentsMatch(left, right) {
  return (
    String(left?.model ?? "") === String(right?.model ?? "") &&
    Number(left?.payloadBytes) === Number(right?.payloadBytes) &&
    normalizedTxid(left?.sha256) === normalizedTxid(right?.sha256)
  );
}

function strictGenericStateFromProjection(value, expectedCommitment) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  if (
    !source ||
    source.model !== "canonical-work-amo-v5-generic-token-state-v1" ||
    !Array.isArray(source.tokens) ||
    !Array.isArray(source.holders) ||
    !Array.isArray(source.listings)
  ) {
    throw new TypeError(
      "work-amo-v5-raw-opening-generic-state-invalid",
    );
  }
  const state = genericStateFromProjection(source);
  const normalized = genericProjectionFromState(state);
  const sourceCommitment = workAmoV5CanonicalPayloadCommitment(source);
  const normalizedCommitment =
    workAmoV5CanonicalPayloadCommitment(normalized);
  if (
    sourceCommitment.sha256 !== normalizedCommitment.sha256 ||
    sourceCommitment.payloadBytes !==
      normalizedCommitment.payloadBytes ||
    !commitmentsMatch(normalizedCommitment, expectedCommitment)
  ) {
    throw new TypeError(
      "work-amo-v5-raw-opening-generic-state-commitment-mismatch",
    );
  }
  for (const definition of state.definitions.values()) {
    const supply = state.supply.get(definition.tokenId) ?? 0n;
    if (
      definition.maxSupply !== null &&
      supply > BigInt(definition.maxSupply)
    ) {
      throw new TypeError(
        "work-amo-v5-raw-opening-generic-state-balance-invalid",
      );
    }
  }
  for (const [key, reserved] of state.reserved) {
    if (reserved > (state.balances.get(key) ?? 0n)) {
      throw new TypeError(
        "work-amo-v5-raw-opening-generic-state-balance-invalid",
      );
    }
  }
  for (const listing of state.listings.values()) {
    const definition = state.definitions.get(listing.tokenId);
    const authorization =
      parseWorkAmoV5GenericSaleAuthorization(
        listing.saleAuthorization,
      );
    if (
      !definition ||
      !authorization ||
      authorization.tokenId !== listing.tokenId ||
      String(authorization.amount) !== listing.amount.toString() ||
      String(authorization.priceSats) !==
        listing.priceSats.toString() ||
      authorization.sellerAddress !== listing.sellerAddress ||
      authorization.registryAddress !==
        definition.registryAddress ||
      authorization.ticker !== definition.ticker
    ) {
      throw new TypeError(
        "work-amo-v5-raw-opening-generic-listing-authorization-invalid",
      );
    }
  }
  return state;
}

function strictIdStateFromProjection(value, expectedCommitment) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  if (
    !source ||
    source.model !== "canonical-work-amo-v5-id-state-v1" ||
    !Array.isArray(source.records) ||
    !Array.isArray(source.listings)
  ) {
    throw new TypeError("work-amo-v5-raw-opening-id-state-invalid");
  }
  const state = idStateFromProjection(source);
  const normalized = idProjectionFromState(state);
  const sourceCommitment = workAmoV5CanonicalPayloadCommitment(source);
  const normalizedCommitment =
    workAmoV5CanonicalPayloadCommitment(normalized);
  if (
    sourceCommitment.sha256 !== normalizedCommitment.sha256 ||
    sourceCommitment.payloadBytes !==
      normalizedCommitment.payloadBytes ||
    !commitmentsMatch(normalizedCommitment, expectedCommitment)
  ) {
    throw new TypeError(
      "work-amo-v5-raw-opening-id-state-commitment-mismatch",
    );
  }
  for (const listing of state.listings.values()) {
    const authorization = parseWorkAmoV5IdSaleAuthorization(
      listing.saleAuthorization,
    );
    if (
      state.records.get(listing.id)?.ownerAddress !==
        listing.sellerAddress ||
      !authorization ||
      authorization.id !== listing.id ||
      String(authorization.priceSats) !==
        listing.priceSats.toString() ||
      authorization.sellerAddress !== listing.sellerAddress
    ) {
      throw new TypeError(
        "work-amo-v5-raw-opening-id-listing-owner-invalid",
      );
    }
  }
  return state;
}

function strictWorkStateFromProjection(value, expectedCommitment) {
  let state;
  let commitment;
  try {
    state = workStateFromProjection(value);
    commitment = workAmoV5CanonicalTokenStateCommitment(value);
  } catch {
    throw new TypeError(
      "work-amo-v5-raw-opening-work-state-invalid",
    );
  }
  if (!commitmentsMatch(commitment, expectedCommitment)) {
    throw new TypeError(
      "work-amo-v5-raw-opening-work-state-commitment-mismatch",
    );
  }
  return state;
}

function cloneGenericState(state) {
  return {
    balances: new OverlayMap(state.balances),
    definitions: new OverlayMap(state.definitions),
    listings: new OverlayMap(state.listings),
    reserved: new OverlayMap(state.reserved),
    supply: new OverlayMap(state.supply),
  };
}

function cloneWorkState(state) {
  return {
    balances: new OverlayMap(state.balances),
    confirmedSupplyAtoms: state.confirmedSupplyAtoms,
    listings: new OverlayMap(state.listings),
    reserved: new OverlayMap(state.reserved),
  };
}

function cloneIdState(state) {
  return {
    listingIdsById: new OverlayMap(state.listingIdsById),
    listings: new OverlayMap(state.listings),
    records: new OverlayMap(state.records),
  };
}

function commitOverlayMap(candidate) {
  if (!(candidate instanceof OverlayMap)) {
    return;
  }
  for (const [key, value] of candidate.changes) {
    if (value === OVERLAY_DELETED) {
      candidate.base.delete(key);
    } else {
      candidate.base.set(key, value);
    }
  }
}

function commitGenericState(current, candidate) {
  if (!candidate || candidate === current) {
    return;
  }
  for (const field of [
    "balances",
    "definitions",
    "listings",
    "reserved",
    "supply",
  ]) {
    commitOverlayMap(candidate[field]);
  }
}

function commitIdState(current, candidate) {
  if (!candidate || candidate === current) {
    return;
  }
  commitOverlayMap(candidate.listingIdsById);
  commitOverlayMap(candidate.listings);
  commitOverlayMap(candidate.records);
}

function commitWorkState(current, candidate) {
  if (!candidate || candidate === current) {
    return;
  }
  commitOverlayMap(candidate.balances);
  commitOverlayMap(candidate.listings);
  commitOverlayMap(candidate.reserved);
  current.confirmedSupplyAtoms = candidate.confirmedSupplyAtoms;
}

function overlayMutationProjection(map) {
  if (!(map instanceof OverlayMap) || map.changes.size === 0) {
    return [];
  }
  return [...map.changes]
    .map(([key, value]) => ({
      key: String(key),
      operation: value === OVERLAY_DELETED ? "delete" : "set",
      ...(value === OVERLAY_DELETED
        ? {}
        : { value: projectionValue(value) }),
    }))
    .sort((left, right) =>
      compareWorkAmoUtf8(left.key, right.key),
    );
}

function stateMutationProjection({
  genericCandidate,
  genericCurrent,
  idCandidate,
  idCurrent,
  workCandidate,
  workCurrent,
}) {
  const generic =
    genericCandidate && genericCandidate !== genericCurrent
      ? Object.fromEntries(
          [
            "balances",
            "definitions",
            "listings",
            "supply",
          ].flatMap((field) => {
            const changes = overlayMutationProjection(
              genericCandidate[field],
            );
            return changes.length > 0 ? [[field, changes]] : [];
          }),
        )
      : {};
  const id =
    idCandidate && idCandidate !== idCurrent
      ? Object.fromEntries(
          ["listings", "records"].flatMap((field) => {
            const changes = overlayMutationProjection(idCandidate[field]);
            return changes.length > 0 ? [[field, changes]] : [];
          }),
        )
      : {};
  const work =
    workCandidate && workCandidate !== workCurrent
      ? {
          ...Object.fromEntries(
            ["balances", "listings"].flatMap((field) => {
              const changes = overlayMutationProjection(
                workCandidate[field],
              );
              return changes.length > 0 ? [[field, changes]] : [];
            }),
          ),
          ...(workCandidate.confirmedSupplyAtoms !==
          workCurrent.confirmedSupplyAtoms
            ? {
                confirmedSupplyAtoms:
                  workCandidate.confirmedSupplyAtoms.toString(),
              }
            : {}),
        }
      : {};
  return { generic, id, work };
}

function genericBalance(state, tokenId, address) {
  return state.balances.get(balanceKey(tokenId, address)) ?? 0n;
}

function genericReserved(state, tokenId, address) {
  return state.reserved.get(balanceKey(tokenId, address)) ?? 0n;
}

function genericSpendable(state, tokenId, address) {
  return (
    genericBalance(state, tokenId, address) -
    genericReserved(state, tokenId, address)
  );
}

function adjustGenericBalance(state, tokenId, address, delta) {
  const owner = String(address ?? "").trim();
  const key = balanceKey(tokenId, owner);
  const next = genericBalance(state, tokenId, owner) + BigInt(delta);
  if (
    !normalizedTxid(tokenId) ||
    !isWorkAmoV5LivenetAddress(owner) ||
    next < 0n
  ) {
    return false;
  }
  state.balances.set(key, next);
  return true;
}

function adjustGenericReserved(state, tokenId, address, delta) {
  const key = balanceKey(tokenId, address);
  const next = genericReserved(state, tokenId, address) + BigInt(delta);
  if (next < 0n) {
    throw new TypeError("work-amo-v5-generic-reservation-negative");
  }
  if (next === 0n) {
    state.reserved.delete(key);
  } else {
    state.reserved.set(key, next);
  }
}

function setGenericListing(state, listingId, listing) {
  const prior = state.listings.get(listingId);
  if (prior) {
    adjustGenericReserved(
      state,
      prior.tokenId,
      prior.sellerAddress,
      -prior.amount,
    );
  }
  state.listings.set(listingId, listing);
  adjustGenericReserved(
    state,
    listing.tokenId,
    listing.sellerAddress,
    listing.amount,
  );
}

function deleteGenericListing(state, listingId) {
  const prior = state.listings.get(listingId);
  if (!prior) {
    return false;
  }
  state.listings.delete(listingId);
  adjustGenericReserved(
    state,
    prior.tokenId,
    prior.sellerAddress,
    -prior.amount,
  );
  return true;
}

function workReserved(state, address) {
  return state.reserved.get(address) ?? 0n;
}

function workBalance(state, address) {
  return state.balances.get(address) ?? 0n;
}

function workSpendable(state, address) {
  return workBalance(state, address) - workReserved(state, address);
}

function adjustWorkBalance(state, address, delta) {
  const owner = String(address ?? "").trim();
  const next = workBalance(state, owner) + BigInt(delta);
  if (!isWorkAmoV5LivenetAddress(owner) || next < 0n) {
    return false;
  }
  state.balances.set(owner, next);
  return true;
}

function adjustWorkReserved(state, address, delta) {
  const next = workReserved(state, address) + BigInt(delta);
  if (next < 0n) {
    throw new TypeError("work-amo-v5-work-reservation-negative");
  }
  if (next === 0n) {
    state.reserved.delete(address);
  } else {
    state.reserved.set(address, next);
  }
}

function setWorkListing(state, listingId, listing) {
  const prior = state.listings.get(listingId);
  if (prior) {
    adjustWorkReserved(
      state,
      prior.sellerAddress,
      -prior.amountAtoms,
    );
  }
  state.listings.set(listingId, listing);
  adjustWorkReserved(
    state,
    listing.sellerAddress,
    listing.amountAtoms,
  );
}

function deleteWorkListing(state, listingId) {
  const prior = state.listings.get(listingId);
  if (!prior) {
    return false;
  }
  state.listings.delete(listingId);
  adjustWorkReserved(
    state,
    prior.sellerAddress,
    -prior.amountAtoms,
  );
  return true;
}

function baseStateQ8(state) {
  const base = Object.fromEntries(
    WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [
      field,
      BigInt(state?.baseState?.[field] ?? "0"),
    ]),
  );
  const marketplaceFlow =
    base.idMarketplaceVolumeSats +
    base.tokenSaleVolumeSats +
    base.idMarketplaceFeeSats +
    base.tokenMarketplaceFeeSats;
  return (
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
      marketplaceFlow +
      base.browserFlowSats +
      base.tokenCreationFlowSats +
      base.tokenMintFlowSats +
      base.tokenTransferFlowSats +
      base.computerEventFlowSats
    ) *
      WORK_AMO_V5_GROWTH_VALUE_MULTIPLE *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE
  );
}

function movementAmountCounts(state) {
  const counts = new Map();
  for (const movement of state.movements) {
    const amountAtoms = BigInt(movement.amountAtoms);
    counts.set(amountAtoms, (counts.get(amountAtoms) ?? 0n) + 1n);
  }
  return counts;
}

function exactMovementLiveValueQ8(counts, frozenNetworkValueQ8) {
  let total = 0n;
  for (const [amountAtoms, count] of counts) {
    total +=
      ((amountAtoms * frozenNetworkValueQ8) /
        WORK_AMO_V5_MOVEMENT_DENOMINATOR) *
      count;
  }
  return total;
}

function economicValue(state, runtime = null) {
  const baseNetworkValueQ8 = baseStateQ8(state);
  const creditFixedQ8 = BigInt(state.creditFixedQ8);
  const frozenNetworkValueQ8 =
    baseNetworkValueQ8 +
    creditFixedQ8 +
    BigInt(state.creditMovementFrozenValueQ8);
  const creditMovementLiveValueQ8 = exactMovementLiveValueQ8(
    runtime?.movementAmountCounts ?? movementAmountCounts(state),
    frozenNetworkValueQ8,
  );
  return {
    baseNetworkValueQ8,
    creditMovementLiveValueQ8,
    frozenNetworkValueQ8,
    networkValueQ8:
      baseNetworkValueQ8 + creditFixedQ8 + creditMovementLiveValueQ8,
  };
}

function createEconomicRuntime(state) {
  const movementIdentities = new Set(
    state.movements.map((movement) => movement.identity),
  );
  if (movementIdentities.size !== state.movements.length) {
    throw new TypeError("work-amo-v5-raw-movement-duplicate");
  }
  const runtime = {
    movementAmountCounts: movementAmountCounts(state),
    movementIdentities,
  };
  const evaluated = economicValue(state, runtime);
  if (evaluated.networkValueQ8 !== BigInt(state.networkValueQ8)) {
    throw new TypeError(
      "work-amo-v5-raw-economic-runtime-value-mismatch",
    );
  }
  return runtime;
}

function normalizeStateDelta(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const totals = new Map();
  for (const contribution of Array.isArray(source.baseContributions)
    ? source.baseContributions
    : []) {
    const field = String(contribution?.field ?? "");
    const amount = exactUnsignedText(contribution?.value);
    if (!WORK_AMO_V5_BASE_STATE_FIELDS.includes(field) || !amount) {
      throw new TypeError("work-amo-v5-raw-base-contribution-invalid");
    }
    totals.set(field, (totals.get(field) ?? 0n) + BigInt(amount));
  }
  const creditFixedQ8 = exactUnsignedText(source.creditFixedQ8 ?? "0");
  const creditFixedSats = exactUnsignedText(
    source.creditFixedSats ?? "0",
  );
  if (!creditFixedQ8 || !creditFixedSats) {
    throw new TypeError("work-amo-v5-raw-fixed-contribution-invalid");
  }
  const economicOutputs = (Array.isArray(source.economicOutputs)
    ? source.economicOutputs
    : []).map((output) => ({
      address: String(output?.address ?? "").trim(),
      attributedSats: exactUnsignedText(output?.attributedSats, {
        positive: true,
      }),
      outputSats: exactUnsignedText(output?.outputSats, {
        positive: true,
      }),
      role: String(output?.role ?? "").trim().toLowerCase(),
      vout: exactSafeInteger(output?.vout),
    }));
  if (
    economicOutputs.some(
      (output) =>
        !output.address ||
        !output.attributedSats ||
        !output.outputSats ||
        !output.role ||
        output.vout === null ||
        BigInt(output.attributedSats) > BigInt(output.outputSats),
    ) ||
    new Set(economicOutputs.map((output) => output.vout)).size !==
      economicOutputs.length
  ) {
    throw new TypeError("work-amo-v5-raw-economic-output-invalid");
  }
  const movement = source.movement
    ? {
        amountAtoms: exactUnsignedText(source.movement.amountAtoms, {
          positive: true,
        }),
        identity: String(source.movement.identity ?? "").trim(),
      }
    : null;
  if (movement && (!movement.amountAtoms || !movement.identity)) {
    throw new TypeError("work-amo-v5-raw-movement-invalid");
  }
  return {
    baseContributions: WORK_AMO_V5_BASE_STATE_FIELDS.flatMap((field) =>
      totals.has(field)
        ? [{ field, value: totals.get(field).toString() }]
        : [],
    ),
    creditFixedQ8,
    creditFixedSats,
    economicOutputs,
    ...(movement ? { movement } : {}),
    ...(Object.hasOwn(source, "quoteHead")
      ? { quoteHead: source.quoteHead }
      : {}),
  };
}

function applyEconomicDelta(
  state,
  delta,
  { mutate = false, runtime = null } = {},
) {
  const normalized = normalizeStateDelta(delta);
  const before = runtime
    ? BigInt(state.networkValueQ8)
    : economicValue(state).networkValueQ8;
  const nextBaseState = { ...state.baseState };
  for (const contribution of normalized.baseContributions) {
    nextBaseState[contribution.field] = (
      BigInt(nextBaseState[contribution.field]) +
      BigInt(contribution.value)
    ).toString();
  }
  const nextCreditFixedQ8 = (
    BigInt(state.creditFixedQ8) +
    BigInt(normalized.creditFixedQ8) +
    BigInt(normalized.creditFixedSats) *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE
  );
  let nextCreditMovementFrozenValueQ8 = BigInt(
    state.creditMovementFrozenValueQ8,
  );
  let movementAmountAtoms = null;
  if (normalized.movement) {
    if (
      runtime
        ? runtime.movementIdentities.has(normalized.movement.identity)
        : state.movements.some(
            (movement) =>
              movement.identity === normalized.movement.identity,
          )
    ) {
      throw new TypeError("work-amo-v5-raw-movement-duplicate");
    }
    movementAmountAtoms = BigInt(normalized.movement.amountAtoms);
    nextCreditMovementFrozenValueQ8 +=
      (BigInt(normalized.movement.amountAtoms) * before) /
      WORK_AMO_V5_MOVEMENT_DENOMINATOR;
  }
  const nextForBase = {
    ...state,
    baseState: nextBaseState,
    creditFixedQ8: nextCreditFixedQ8.toString(),
    creditMovementFrozenValueQ8:
      nextCreditMovementFrozenValueQ8.toString(),
  };
  const baseNetworkValueQ8 = baseStateQ8(nextForBase);
  const frozenNetworkValueQ8 =
    baseNetworkValueQ8 +
    nextCreditFixedQ8 +
    nextCreditMovementFrozenValueQ8;
  const counts =
    runtime?.movementAmountCounts ?? movementAmountCounts(state);
  let creditMovementLiveValueQ8 = exactMovementLiveValueQ8(
    counts,
    frozenNetworkValueQ8,
  );
  if (movementAmountAtoms !== null) {
    creditMovementLiveValueQ8 +=
      (movementAmountAtoms * frozenNetworkValueQ8) /
      WORK_AMO_V5_MOVEMENT_DENOMINATOR;
  }
  const networkValueAfterQ8 =
    baseNetworkValueQ8 +
    nextCreditFixedQ8 +
    creditMovementLiveValueQ8;
  if (networkValueAfterQ8 < before) {
    throw new TypeError("work-amo-v5-raw-network-value-regressed");
  }
  const next = mutate
    ? state
    : {
        ...state,
        movements: normalized.movement
          ? [...state.movements, normalized.movement]
          : state.movements,
      };
  next.baseState = nextBaseState;
  next.creditFixedQ8 = nextCreditFixedQ8.toString();
  next.creditMovementFrozenValueQ8 =
    nextCreditMovementFrozenValueQ8.toString();
  next.networkValueQ8 = networkValueAfterQ8.toString();
  if (normalized.movement && mutate) {
    next.movements.push(normalized.movement);
  }
  if (Object.hasOwn(normalized, "quoteHead")) {
    next.quoteHead = normalized.quoteHead;
  }
  if (normalized.movement && runtime && mutate) {
    runtime.movementIdentities.add(normalized.movement.identity);
    runtime.movementAmountCounts.set(
      movementAmountAtoms,
      (runtime.movementAmountCounts.get(movementAmountAtoms) ?? 0n) +
        1n,
    );
  }
  return {
    bondContributionQ8: (networkValueAfterQ8 - before).toString(),
    networkValueAfterQ8: next.networkValueQ8,
    networkValueBeforeQ8: before.toString(),
    state: next,
  };
}

function claimedForTx(claimedByTxid, txid) {
  return new Set(claimedByTxid.get(txid) ?? []);
}

function singleRegistryClaim(
  record,
  claimed,
  {
    address,
    attributedSats,
    requireBeforeProtocol = true,
    requiredSats,
    role,
  },
) {
  const payment = selectWorkAmoV5DistinctRegistryPayment(
    rawOutputs(record),
    {
      claimedVouts: claimed,
      protocolVout: record.position.protocolVout,
      registryAddress: address,
      requireBeforeProtocol,
      requiredSats,
    },
  );
  if (!payment) {
    return null;
  }
  claimed.add(payment.registryPaymentVout);
  return {
    payment,
    outputs: [{
      address: payment.registryAddress,
      attributedSats: String(
        attributedSats ?? payment.registryPaymentSats,
      ),
      outputSats: String(payment.registryPaymentSats),
      role,
      vout: payment.registryPaymentVout,
    }],
  };
}

function smallestSingleClaim(
  record,
  claimed,
  {
    address,
    attributedSats,
    candidateVouts = [],
    requireBeforeProtocol = true,
    requiredSats,
    role,
  },
) {
  const assignment = assignWorkAmoV5EconomicOutputs(
    rawOutputs(record),
    [{
      address,
      candidateVouts,
      claimAll: false,
      requireBeforeProtocol,
      requiredSats: String(requiredSats),
      role,
    }],
    {
      claimedVouts: claimed,
      protocolVout: record.position.protocolVout,
    },
  );
  const selected = assignment?.economicOutputs ?? [];
  if (selected.length !== 1) {
    return null;
  }
  const output = selected[0];
  claimed.add(output.vout);
  return {
    output: {
      address: output.address,
      attributedSats: String(attributedSats ?? requiredSats),
      outputSats: String(output.outputSats),
      role,
      vout: output.vout,
    },
  };
}

function aggregateClaim(
  record,
  claimed,
  {
    address,
    requireBeforeProtocol = true,
    requiredSats,
    role,
  },
) {
  const assignment = assignWorkAmoV5EconomicOutputs(
    rawOutputs(record),
    [{
      address,
      candidateVouts: [],
      claimAll: false,
      requireBeforeProtocol,
      requiredSats: String(requiredSats),
      role,
    }],
    {
      claimedVouts: claimed,
      protocolVout: record.position.protocolVout,
    },
  );
  if (!assignment || assignment.economicOutputs.length === 0) {
    return null;
  }
  for (const output of assignment.economicOutputs) {
    claimed.add(output.vout);
  }
  return {
    outputs: assignment.economicOutputs.map(
      ({ requirementIndex, ...output }) => ({
        ...output,
        attributedSats: String(output.attributedSats),
        outputSats: String(output.outputSats),
      }),
    ),
  };
}

function claimExactOutput(record, claimed, vout) {
  const output = rawOutputAt(record, vout);
  if (!output || claimed.has(output.vout)) {
    return null;
  }
  claimed.add(output.vout);
  return output;
}

function evaluatePwa(record, context) {
  const parsed = parseWorkAmoUsdQuoteRecord(record.message);
  if (!parsed) {
    return invalidOutcome(
      "work-amo-v5-quote-payload-invalid",
      null,
      "work-usd-quote",
    );
  }
  const claimed = claimedForTx(context.claimedByTxid, record.txid);
  const registry = singleRegistryClaim(record, claimed, {
    address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    requireBeforeProtocol: false,
    requiredSats: WORK_AMO_V5_MIN_PAYMENT_SATS,
    role: "pwa-registry",
  });
  if (!registry) {
    return invalidOutcome(
      "work-amo-v5-quote-registry-payment-unavailable",
      parsed,
      "work-usd-quote",
    );
  }
  const recordCount =
    context.validPwaRecordCountsByTxid.get(record.txid) ?? 0;
  const evidence = {
    ...record.position,
    canonical: true,
    confirmed: true,
    firstInputPrevoutScriptPubKey: firstInputScript(record),
    payload: record.message,
    recordCount,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    registryPaymentSats:
      registry.payment.registryPaymentSats,
    registryPaymentVout:
      registry.payment.registryPaymentVout,
    requiredRegistryPaymentSats:
      registry.payment.requiredRegistryPaymentSats,
    txid: record.txid,
  };
  const validation = validateWorkAmoUsdQuoteEvidence(evidence);
  if (!validation.valid) {
    return invalidOutcome(
      validation.reasonCode,
      parsed,
      "work-usd-quote",
    );
  }
  const previous = context.economicState.quoteHead;
  const expectedSequence = previous
    ? (BigInt(previous.sequence) + 1n).toString()
    : "1";
  const expectedPreviousTxid =
    previous?.txid ?? parsed.v1DeclarationTxid;
  if (
    validation.quote.sequence !== expectedSequence ||
    validation.quote.previousQuoteTxid !== expectedPreviousTxid
  ) {
    return invalidOutcome(
      "work-amo-v5-quote-not-canonical-chain",
      parsed,
      "work-usd-quote",
    );
  }
  const stateDelta = normalizeStateDelta({
    baseContributions: [{
      field: "computerEventFlowSats",
      value: String(registry.payment.registryPaymentSats),
    }],
    economicOutputs: registry.outputs.map((output) => ({
      ...output,
      attributedSats: String(registry.payment.registryPaymentSats),
    })),
    quoteHead: validation.quote,
  });
  return {
    claimed,
    derived: [],
    output: {
      quote: validation.quote,
      registryPayment: registry.payment,
    },
    parsed,
    reasonCode: "",
    semanticKind: "work-usd-quote",
    stateDelta,
    valid: true,
  };
}

function pwmMessages(record) {
  const parts = Array.isArray(record?.rawRecordParts)
    ? record.rawRecordParts
    : Array.isArray(record?.payload?.rawRecordParts)
      ? record.payload.rawRecordParts
      : [];
  return parts.length > 0
    ? parts.map((part) => String(part?.text ?? "")).filter(Boolean)
    : String(record?.message ?? "")
        .split("\n")
        .filter(Boolean);
}

function evaluatePwm(record, context) {
  const parsed = parseWorkAmoV5PwmMessages(pwmMessages(record));
  if (!parsed) {
    return invalidOutcome(
      "work-amo-v5-raw-pwm-invalid",
      null,
      "protocol-event-invalid",
    );
  }
  const claimed = claimedForTx(context.claimedByTxid, record.txid);
  const candidates = rawOutputs(record)
    .filter((output) => output.vout < record.position.protocolVout)
    .map((output) => output.vout);
  const assignment = assignWorkAmoV5EconomicOutputs(
    rawOutputs(record),
    [{
      candidateVouts: candidates,
      claimAll: true,
      requireBeforeProtocol: true,
      role: "pwm-recipient",
    }],
    {
      claimedVouts: claimed,
      protocolVout: record.position.protocolVout,
    },
  );
  if (!assignment || assignment.economicOutputs.length === 0) {
    return invalidOutcome(
      "work-amo-v5-pwm-output-conflict",
      parsed,
      parsed.kind,
    );
  }
  const payments = assignment.economicOutputs.map((output) => ({
    address: output.address,
    amountSats: String(output.outputSats),
    outputSats: String(output.outputSats),
    vout: output.vout,
  }));
  for (const payment of payments) {
    claimed.add(payment.vout);
  }
  const total = payments.reduce(
    (sum, payment) => sum + BigInt(payment.amountSats),
    0n,
  );
  const genericState = cloneGenericState(context.genericState);
  const tokenId =
    parsed.tokenFamily === "POWB"
      ? WORK_AMO_V5_POWB_TOKEN_ID
      : parsed.tokenFamily === "INCB"
        ? WORK_AMO_V5_INCB_TOKEN_ID
        : "";
  const derived = [];
  if (tokenId) {
    if (!genericState.definitions.has(tokenId)) {
      return invalidOutcome(
        "work-amo-v5-synthetic-bond-definition-missing",
        parsed,
        parsed.kind,
      );
    }
    for (const [recipientIndex, payment] of payments.entries()) {
      const amount = BigInt(payment.amountSats);
      if (
        amount <= 0n ||
        !adjustGenericBalance(
          genericState,
          tokenId,
          payment.address,
          amount,
        )
      ) {
        return invalidOutcome(
          "work-amo-v5-synthetic-bond-state-invalid",
          parsed,
          parsed.kind,
        );
      }
      genericState.supply.set(
        tokenId,
        (genericState.supply.get(tokenId) ?? 0n) + amount,
      );
      derived.push({
        amount: amount.toString(),
        chargesTransactionFee: false,
        claimsEconomicOutputs: false,
        economicDelta: false,
        kind: "token-mint",
        parentPosition: record.position,
        rawCandidate: false,
        recipientAddress: payment.address,
        recipientIndex,
        recipientVout: payment.vout,
        tokenId,
      });
    }
    if (parsed.tokenFamily === "INCB") {
      const priorWorkSends =
        context.workSendsByTxid.get(record.txid) ?? [];
      const openingNetworkValueQ8 = BigInt(
        context.blockOpeningEconomicState.networkValueQ8,
      );
      for (const send of priorWorkSends) {
        const matchedBondRecipientVouts = payments
          .filter(
            (payment) =>
              payment.address === send.recipientAddress,
          )
          .map((payment) => payment.vout)
          .sort((left, right) => left - right);
        if (matchedBondRecipientVouts.length === 0) {
          continue;
        }
        const amountAtoms = BigInt(send.amountAtoms);
        const attachedWorkLiveValueAtSendQ8 =
          (amountAtoms * openingNetworkValueQ8) /
          WORK_AMO_V5_MOVEMENT_DENOMINATOR;
        const attachedWorkIssuanceUnits =
          attachedWorkLiveValueAtSendQ8 / WORK_AMO_VALUE_Q8_SCALE;
        if (
          attachedWorkIssuanceUnits > 0n &&
          !adjustGenericBalance(
            genericState,
            WORK_AMO_V5_INCB_TOKEN_ID,
            send.recipientAddress,
            attachedWorkIssuanceUnits,
          )
        ) {
          return invalidOutcome(
            "work-amo-v5-incb-attachment-state-invalid",
            parsed,
            parsed.kind,
          );
        }
        if (attachedWorkIssuanceUnits > 0n) {
          genericState.supply.set(
            WORK_AMO_V5_INCB_TOKEN_ID,
            (genericState.supply.get(
              WORK_AMO_V5_INCB_TOKEN_ID,
            ) ?? 0n) + attachedWorkIssuanceUnits,
          );
        }
        derived.push({
          amount: attachedWorkIssuanceUnits.toString(),
          attachedWorkAmountAtoms: amountAtoms.toString(),
          attachedWorkIssuanceUnits:
            attachedWorkIssuanceUnits.toString(),
          attachedWorkLiveValueAtSendQ8:
            attachedWorkLiveValueAtSendQ8.toString(),
          attachmentAppliedAtPosition: record.position,
          chargesTransactionFee: false,
          claimsEconomicOutputs: false,
          economicDelta: false,
          kind: "token-mint",
          matchedBondRecipientVouts,
          parentPosition: record.position,
          rawCandidate: false,
          recipientAddress: send.recipientAddress,
          tokenId: WORK_AMO_V5_INCB_TOKEN_ID,
          workSendPosition: send.position,
        });
      }
    }
  }
  const stateDelta = normalizeStateDelta({
    baseContributions: [{
      field: parsed.contributionField,
      value: total.toString(),
    }],
    economicOutputs: payments.map((payment) => ({
      address: payment.address,
      attributedSats: payment.amountSats,
      outputSats: payment.amountSats,
      role: "pwm-recipient",
      vout: payment.vout,
    })),
  });
  return {
    claimed,
    derived,
    genericState,
    output: {
      classification: parsed,
      recipients: payments,
    },
    parsed,
    reasonCode: "",
    semanticKind: parsed.kind,
    stateDelta,
    valid: true,
  };
}

function evaluatePwr(record, context) {
  const parsed = parseWorkAmoV5RawPwrRecord(record.message);
  if (!parsed) {
    return invalidOutcome(
      "work-amo-v5-raw-pwr-invalid",
      null,
      "rush-mint",
    );
  }
  const senderAddress = firstAddressBearingInput(record);
  const claimed = claimedForTx(context.claimedByTxid, record.txid);
  const registry = aggregateClaim(record, claimed, {
    address: WORK_AMO_V5_RUSH_REGISTRY_ADDRESS,
    requireBeforeProtocol: true,
    requiredSats: WORK_AMO_V5_WORK_MINT_PAYMENT_SATS,
    role: "pwr-registry",
  });
  if (!registry || !isWorkAmoV5LivenetAddress(senderAddress)) {
    return invalidOutcome(
      "work-amo-v5-raw-pwr-payment-invalid",
      parsed,
      "rush-mint",
    );
  }
  return {
    claimed,
    derived: [],
    output: { registryPayments: registry.outputs },
    parsed,
    reasonCode: "",
    semanticKind: "rush-mint",
    stateDelta: normalizeStateDelta({
      baseContributions: [{
        field: "computerEventFlowSats",
        value: String(WORK_AMO_V5_WORK_MINT_PAYMENT_SATS),
      }],
      economicOutputs: registry.outputs,
    }),
    valid: true,
  };
}

function transactionTimeMs(record) {
  const candidate = record?.canonicalBlockTimeMs;
  return Number.isSafeInteger(candidate) && candidate >= 0
    ? candidate
    : Number.NaN;
}

function authorizationExpiredForRecord(authorization, record) {
  const expiresAt = String(authorization?.expiresAt ?? "");
  if (!expiresAt) {
    return false;
  }
  const expiresAtMs = workAmoV5CanonicalExpiryMs(expiresAt);
  const eventTimeMs = transactionTimeMs(record);
  return (
    !Number.isSafeInteger(expiresAtMs) ||
    !Number.isSafeInteger(eventTimeMs) ||
    eventTimeMs > expiresAtMs
  );
}

function setIdListing(state, listingId, listing) {
  const prior = state.listings.get(listingId);
  if (prior) {
    const priorIds = new Set(
      state.listingIdsById.get(prior.id) ?? [],
    );
    priorIds.delete(listingId);
    if (priorIds.size === 0) {
      state.listingIdsById.delete(prior.id);
    } else {
      state.listingIdsById.set(prior.id, priorIds);
    }
  }
  state.listings.set(listingId, listing);
  const listingIds = new Set(
    state.listingIdsById.get(listing.id) ?? [],
  );
  listingIds.add(listingId);
  state.listingIdsById.set(listing.id, listingIds);
}

function deleteIdListing(state, listingId) {
  const prior = state.listings.get(listingId);
  if (!prior) {
    return false;
  }
  state.listings.delete(listingId);
  const listingIds = new Set(
    state.listingIdsById.get(prior.id) ?? [],
  );
  listingIds.delete(listingId);
  if (listingIds.size === 0) {
    state.listingIdsById.delete(prior.id);
  } else {
    state.listingIdsById.set(prior.id, listingIds);
  }
  return true;
}

function invalidateIdListingsFor(state, id) {
  for (const listingId of state.listingIdsById.get(id) ?? []) {
    deleteIdListing(state, listingId);
  }
}

function evaluatePwid(record, context) {
  const parsed = parseWorkAmoV5RawPwidRecord(record.message);
  if (!parsed) {
    return invalidOutcome(
      "work-amo-v5-raw-pwid-invalid",
      null,
      "protocol-event-invalid",
    );
  }
  const idState = cloneIdState(context.idState);
  const inputs = inputAddresses(record);
  const marketplace = [
    "id-list",
    "id-seal",
    "id-delist",
    "id-buy",
  ].includes(parsed.kind);
  const requiredSats =
    parsed.kind === "id-register" ? 1_000 : 546;
  const claimed = claimedForTx(context.claimedByTxid, record.txid);
  const registry = aggregateClaim(record, claimed, {
    address: WORK_AMO_V5_ID_REGISTRY_ADDRESS,
    requireBeforeProtocol: true,
    requiredSats,
    role: "pwid-registry",
  });
  if (!registry) {
    return invalidOutcome(
      "work-amo-v5-raw-pwid-payment-invalid",
      parsed,
      parsed.kind,
    );
  }
  let listing = null;
  let sellerOutput = null;
  let output = null;
  const derived = [];
  if (parsed.kind === "id-register") {
    if (idState.records.has(parsed.id)) {
      return invalidOutcome(
        "work-amo-v5-id-registration-conflict",
        parsed,
        parsed.kind,
      );
    }
    idState.records.set(parsed.id, {
      id: parsed.id,
      ownerAddress: parsed.ownerAddress,
      pgpKey: parsed.pgpKey ?? "",
      receiveAddress: parsed.receiveAddress,
    });
  } else if (parsed.kind === "id-update") {
    const current = idState.records.get(parsed.id);
    if (!current || !inputs.includes(current.ownerAddress)) {
      return invalidOutcome(
        "work-amo-v5-id-update-owner-invalid",
        parsed,
        parsed.kind,
      );
    }
    idState.records.set(parsed.id, {
      ...current,
      receiveAddress: parsed.receiveAddress,
    });
  } else if (parsed.kind === "id-transfer") {
    const current = idState.records.get(parsed.id);
    if (!current || !inputs.includes(current.ownerAddress)) {
      return invalidOutcome(
        "work-amo-v5-id-transfer-owner-invalid",
        parsed,
        parsed.kind,
      );
    }
    idState.records.set(parsed.id, {
      ...current,
      ownerAddress: parsed.ownerAddress,
      receiveAddress: parsed.receiveAddress,
    });
    invalidateIdListingsFor(idState, parsed.id);
  } else if (parsed.kind === "id-list") {
    const authorization = parsed.saleAuthorization;
    const current = idState.records.get(authorization.id);
    const anchor = claimExactOutput(
      record,
      claimed,
      authorization.anchorVout,
    );
    if (
      !current ||
      current.ownerAddress !== authorization.sellerAddress ||
      !inputs.includes(current.ownerAddress) ||
      authorization.anchorTxid ||
      authorization.anchorSignature ||
      authorizationExpiredForRecord(authorization, record) ||
      !anchor ||
      anchor.amountSats !== authorization.anchorValueSats ||
      anchor.scriptPubKeyHex !== authorization.anchorScriptPubKey ||
      idState.listings.has(record.txid)
    ) {
      return invalidOutcome(
        "work-amo-v5-id-listing-state-invalid",
        parsed,
        parsed.kind,
      );
    }
    listing = {
      id: authorization.id,
      listingId: record.txid,
      priceSats: BigInt(authorization.priceSats),
      saleAuthorization: authorization,
      sellerAddress: authorization.sellerAddress,
    };
    setIdListing(idState, record.txid, listing);
    output = { listing };
  } else {
    listing = idState.listings.get(parsed.listingId);
    const current = listing
      ? idState.records.get(listing.id)
      : null;
    if (
      !listing ||
      !current ||
      current.ownerAddress !== listing.sellerAddress
    ) {
      return invalidOutcome(
        "work-amo-v5-id-listing-unavailable",
        parsed,
        parsed.kind,
      );
    }
    const authorization = listing.saleAuthorization;
    if (parsed.kind === "id-seal") {
      const signed = parsed.saleAuthorization;
      const signature = validateWorkAmoV5SaleTicketSignature({
        authorization: signed,
        listingId: listing.listingId,
        network: "livenet",
        unitPriceSats: listing.priceSats.toString(),
      });
      if (
        !inputs.includes(current.ownerAddress) ||
        !workAmoV5IdSaleAuthorizationsMatch(
          signed,
          authorization,
        ) ||
        signed.anchorTxid !== listing.listingId ||
        signature.valid !== true
      ) {
        return invalidOutcome(
          "work-amo-v5-id-seal-invalid",
          parsed,
          parsed.kind,
        );
      }
      listing = {
        ...listing,
        saleAuthorization: signed,
      };
      setIdListing(idState, listing.listingId, listing);
      output = { listing };
    } else if (parsed.kind === "id-delist") {
      if (
        !inputs.includes(current.ownerAddress) ||
        !transactionSpends(
          record,
          listing.listingId,
          authorization.anchorVout,
        )
      ) {
        return invalidOutcome(
          "work-amo-v5-id-delist-invalid",
          parsed,
          parsed.kind,
        );
      }
      deleteIdListing(idState, listing.listingId);
      output = { closedListing: listing };
    } else if (parsed.kind === "id-buy") {
      const signature = validateWorkAmoV5SaleTicketSignature({
        authorization,
        listingId: listing.listingId,
        network: "livenet",
        unitPriceSats: listing.priceSats.toString(),
      });
      sellerOutput = smallestSingleClaim(record, claimed, {
        address: listing.sellerAddress,
        attributedSats: listing.priceSats.toString(),
        requireBeforeProtocol: true,
        requiredSats:
          listing.priceSats + BigInt(authorization.anchorValueSats),
        role: "pwid-seller",
      });
      if (
        signature.valid !== true ||
        !inputs.includes(parsed.ownerAddress) ||
        !transactionSpends(
          record,
          listing.listingId,
          authorization.anchorVout,
        ) ||
        !sellerOutput ||
        authorizationExpiredForRecord(authorization, record) ||
        (authorization.buyerAddress &&
          authorization.buyerAddress !== parsed.ownerAddress) ||
        (authorization.receiveAddress &&
          authorization.receiveAddress !== parsed.receiveAddress)
      ) {
        return invalidOutcome(
          "work-amo-v5-id-buy-invalid",
          parsed,
          parsed.kind,
        );
      }
      idState.records.set(listing.id, {
        ...current,
        ownerAddress: parsed.ownerAddress,
        receiveAddress: parsed.receiveAddress,
      });
      invalidateIdListingsFor(idState, listing.id);
      output = {
        listing,
        ownerAddress: parsed.ownerAddress,
        receiveAddress: parsed.receiveAddress,
      };
      derived.push({
        closedListing: listing,
        kind: "id-listing-closed",
        listingId: listing.listingId,
        protocol: "pwid1",
      });
    }
  }
  const baseContributions = [
    ...(parsed.kind === "id-register"
      ? [
          { field: "powids", value: "1" },
          {
            field: "computerEventFlowSats",
            value: String(requiredSats),
          },
        ]
      : marketplace
        ? [{
            field: "idMarketplaceFeeSats",
            value: String(requiredSats),
          }]
        : [{
            field: "computerEventFlowSats",
            value: String(requiredSats),
          }]),
    ...(parsed.kind === "id-buy" && listing.priceSats > 0n
      ? [{
          field: "idMarketplaceVolumeSats",
          value: listing.priceSats.toString(),
        }]
      : []),
  ];
  return {
    claimed,
    derived,
    idState,
    output,
    parsed,
    reasonCode: "",
    semanticKind: parsed.kind,
    stateDelta: normalizeStateDelta({
      baseContributions,
      economicOutputs: [
        ...registry.outputs,
        ...(sellerOutput && listing.priceSats > 0n
          ? [sellerOutput.output]
          : []),
      ],
    }),
    valid: true,
  };
}

function genericSemanticKind(kind) {
  return {
    buy: "token-sale",
    create: "token-create",
    delist: "token-listing-closed",
    list: "token-listing",
    mint: "token-mint",
    seal: "token-listing-sealed",
    send: "token-transfer",
  }[kind] ?? "token-event-invalid";
}

function evaluateGenericPwt(record, context, parsed) {
  const genericState = cloneGenericState(context.genericState);
  const derived = [];
  const senderAddress = firstAddressBearingInput(record);
  if (!isWorkAmoV5LivenetAddress(senderAddress)) {
    return invalidOutcome(
      "work-amo-v5-generic-token-state-unavailable",
      parsed,
      genericSemanticKind(parsed.kind),
    );
  }
  const claimed = claimedForTx(context.claimedByTxid, record.txid);
  let definition = null;
  let listing = null;
  let tokenId = normalizedTxid(
    parsed.tokenId ?? parsed.saleAuthorization?.tokenId,
  );
  let registryAddress = "";
  let requiredSats = WORK_AMO_V5_MIN_PAYMENT_SATS;
  if (parsed.kind === "create") {
    tokenId = record.txid;
    registryAddress = WORK_AMO_V5_TOKEN_INDEX_ADDRESS;
  } else if (["buy", "delist"].includes(parsed.kind)) {
    listing = genericState.listings.get(parsed.listingId);
    tokenId = listing?.tokenId ?? tokenId;
    definition = genericState.definitions.get(tokenId);
    registryAddress = definition?.registryAddress ?? "";
  } else {
    definition = genericState.definitions.get(tokenId);
    registryAddress = definition?.registryAddress ?? "";
    if (parsed.kind === "mint") {
      requiredSats = definition
        ? BigInt(definition.mintPriceSats)
        : 0n;
    }
  }
  const registry = aggregateClaim(record, claimed, {
    address: registryAddress,
    requireBeforeProtocol: true,
    requiredSats,
    role:
      parsed.kind === "create"
        ? "pwt-index-registry"
        : "pwt-token-registry",
  });
  if (!registry) {
    return invalidOutcome(
      "work-amo-v5-generic-registry-payment-unavailable",
      parsed,
      genericSemanticKind(parsed.kind),
    );
  }
  const baseContributions = [];
  let sellerOutput = null;
  let output = null;
  if (parsed.kind === "create") {
    const created = normalizeDefinition({
      ...parsed,
      tokenId,
    });
    if (
      !created ||
      genericState.definitions.has(tokenId) ||
      WORK_AMO_V5_RESERVED_TOKEN_IDS.has(tokenId) ||
      ["WORK", "POWB", "INCB"].includes(created.ticker)
    ) {
      return invalidOutcome(
        "work-amo-v5-generic-create-invalid",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    genericState.definitions.set(tokenId, created);
    genericState.supply.set(tokenId, 0n);
    baseContributions.push({
      field: "tokenCreationFlowSats",
      value: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
    });
    output = { definition: created };
  } else if (parsed.kind === "mint") {
    const amount = BigInt(exactUnsignedText(parsed.amount, {
      positive: true,
    }) || "0");
    const supply = genericState.supply.get(tokenId) ?? 0n;
    if (
      !definition ||
      WORK_AMO_V5_RESERVED_TOKEN_IDS.has(tokenId) ||
      amount !== BigInt(definition.mintAmount) ||
      (definition.maxSupply !== null &&
        supply + amount > BigInt(definition.maxSupply)) ||
      !adjustGenericBalance(
        genericState,
        tokenId,
        senderAddress,
        amount,
      )
    ) {
      return invalidOutcome(
        "work-amo-v5-generic-mint-invalid",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    genericState.supply.set(tokenId, supply + amount);
    baseContributions.push({
      field: "tokenMintFlowSats",
      value: definition.mintPriceSats,
    });
    output = {
      amount: amount.toString(),
      recipientAddress: senderAddress,
      tokenId,
    };
  } else if (parsed.kind === "send") {
    const amount = BigInt(exactUnsignedText(parsed.amount, {
      positive: true,
    }) || "0");
    if (
      !definition ||
      amount <= 0n ||
      !isWorkAmoV5LivenetAddress(parsed.recipientAddress) ||
      genericSpendable(
        genericState,
        tokenId,
        senderAddress,
      ) < amount ||
      !adjustGenericBalance(
        genericState,
        tokenId,
        senderAddress,
        -amount,
      ) ||
      !adjustGenericBalance(
        genericState,
        tokenId,
        parsed.recipientAddress,
        amount,
      )
    ) {
      return invalidOutcome(
        "work-amo-v5-generic-transfer-invalid",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    baseContributions.push({
      field: "tokenTransferFlowSats",
      value: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
    });
    output = {
      amount: amount.toString(),
      recipientAddress: parsed.recipientAddress,
      senderAddress,
      tokenId,
    };
  } else if (parsed.kind === "list") {
    const authorization = parseWorkAmoV5GenericSaleAuthorization(
      parsed.saleAuthorization,
    );
    const amount = authorization
      ? BigInt(authorization.amount)
      : 0n;
    const anchor = authorization
      ? claimExactOutput(record, claimed, authorization.anchorVout)
      : null;
    if (
      !authorization ||
      !definition ||
      authorization.tokenId !== tokenId ||
      authorization.ticker !== definition.ticker ||
      authorization.registryAddress !== definition.registryAddress ||
      authorization.sellerAddress !== senderAddress ||
      genericState.listings.has(record.txid) ||
      genericSpendable(genericState, tokenId, senderAddress) < amount ||
      authorizationExpiredForRecord(authorization, record) ||
      !anchor ||
      anchor.amountSats !== authorization.anchorValueSats ||
      anchor.scriptPubKeyHex !== authorization.anchorScriptPubKey
    ) {
      return invalidOutcome(
        "work-amo-v5-generic-list-invalid",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    listing = {
      amount,
      listingId: record.txid,
      priceSats: BigInt(authorization.priceSats),
      saleAuthorization: authorization,
      sellerAddress: senderAddress,
      tokenId,
    };
    setGenericListing(genericState, record.txid, listing);
    baseContributions.push({
      field: "tokenMarketplaceFeeSats",
      value: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
    });
    output = { listing };
  } else {
    listing ??= genericState.listings.get(parsed.listingId);
    definition ??= genericState.definitions.get(listing?.tokenId);
    tokenId = listing?.tokenId ?? "";
    if (!listing || !definition) {
      return invalidOutcome(
        "work-amo-v5-generic-listing-unavailable",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    if (parsed.kind === "seal") {
      const authorization = parseWorkAmoV5GenericSaleAuthorization(
        parsed.saleAuthorization,
      );
      const signature = authorization
        ? validateWorkAmoV5SaleTicketSignature({
            authorization,
            listingId: listing.listingId,
            network: "livenet",
            unitPriceSats: listing.priceSats.toString(),
          })
        : { valid: false };
      if (
        listing.sellerAddress !== senderAddress ||
        !authorization ||
        !workAmoV5GenericSaleAuthorizationsMatch(
          authorization,
          listing.saleAuthorization,
        ) ||
        authorization.anchorTxid !== listing.listingId ||
        signature.valid !== true
      ) {
        return invalidOutcome(
          "work-amo-v5-generic-seal-invalid",
          parsed,
          genericSemanticKind(parsed.kind),
        );
      }
      listing = {
        ...listing,
        saleAuthorization: authorization,
      };
      setGenericListing(genericState, listing.listingId, listing);
      output = { listing };
    } else if (parsed.kind === "delist") {
      if (
        listing.sellerAddress !== senderAddress ||
        !transactionSpends(
          record,
          listing.listingId,
          listing.saleAuthorization.anchorVout,
        )
      ) {
        return invalidOutcome(
          "work-amo-v5-generic-delist-invalid",
          parsed,
          genericSemanticKind(parsed.kind),
        );
      }
      deleteGenericListing(genericState, listing.listingId);
      output = { closedListing: listing };
    } else if (parsed.kind === "buy") {
      const authorization =
        parsed.saleAuthorization == null
          ? listing.saleAuthorization
          : parseWorkAmoV5GenericSaleAuthorization(
              parsed.saleAuthorization,
            );
      const signature = validateWorkAmoV5SaleTicketSignature({
        authorization,
        listingId: listing.listingId,
        network: "livenet",
        unitPriceSats: listing.priceSats.toString(),
      });
      sellerOutput = smallestSingleClaim(record, claimed, {
        address: listing.sellerAddress,
        attributedSats: listing.priceSats.toString(),
        requireBeforeProtocol: true,
        requiredSats:
          listing.priceSats +
          BigInt(
            authorization?.anchorValueSats ??
              WORK_AMO_V5_LISTING_ANCHOR_VALUE_SATS,
          ),
        role: "pwt-seller",
      });
      if (
        senderAddress !== parsed.buyerAddress ||
        !authorization ||
        signature.valid !== true ||
        (parsed.saleAuthorization &&
          !workAmoV5GenericSaleAuthorizationsMatch(
            authorization,
            listing.saleAuthorization,
          )) ||
        (listing.saleAuthorization.buyerAddress &&
          listing.saleAuthorization.buyerAddress !== parsed.buyerAddress) ||
        authorizationExpiredForRecord(
          listing.saleAuthorization,
          record,
        ) ||
        !transactionSpends(
          record,
          listing.listingId,
          listing.saleAuthorization.anchorVout,
        ) ||
        !sellerOutput ||
        genericBalance(
          genericState,
          tokenId,
          listing.sellerAddress,
        ) < listing.amount ||
        !adjustGenericBalance(
          genericState,
          tokenId,
          listing.sellerAddress,
          -listing.amount,
        ) ||
        !adjustGenericBalance(
          genericState,
          tokenId,
          parsed.buyerAddress,
          listing.amount,
        )
      ) {
        return invalidOutcome(
          "work-amo-v5-generic-buy-invalid",
          parsed,
          genericSemanticKind(parsed.kind),
        );
      }
      deleteGenericListing(genericState, listing.listingId);
      baseContributions.push({
        field: "tokenSaleVolumeSats",
        value: listing.priceSats.toString(),
      });
      output = {
        buyerAddress: parsed.buyerAddress,
        listing,
      };
      derived.push({
        closedListing: listing,
        kind: "token-listing-closed",
        listingId: listing.listingId,
        tokenId,
      });
    } else {
      return invalidOutcome(
        "work-amo-v5-generic-action-unsupported",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    baseContributions.push({
      field: "tokenMarketplaceFeeSats",
      value: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
    });
  }
  return {
    claimed,
    derived,
    genericState,
    output,
    parsed,
    reasonCode: "",
    semanticKind: genericSemanticKind(parsed.kind),
    stateDelta: normalizeStateDelta({
      baseContributions,
      economicOutputs: [
        ...registry.outputs,
        ...(sellerOutput ? [sellerOutput.output] : []),
      ],
    }),
    valid: true,
  };
}

function workAuthorizationsMatch(left, right) {
  const leftValidation = validateWorkAmoV5StaticAuthorization(left);
  const rightValidation = validateWorkAmoV5StaticAuthorization(right);
  if (!leftValidation.valid || !rightValidation.valid) {
    return false;
  }
  return [
    "anchorScriptPubKey",
    "anchorSigHashType",
    "anchorType",
    "anchorValueSats",
    "anchorVout",
    "buyerAddress",
    "expiresAt",
    "network",
    "nonce",
    "registryAddress",
    "sellerAddress",
    "sellerPublicKey",
    "ticker",
    "tokenId",
    "unitFaceUsdCents",
    "version",
  ].every(
    (field) =>
      leftValidation.authorization[field] ===
      rightValidation.authorization[field],
  );
}

function listingPosition(listing) {
  const terms = listing?.frozenTerms ?? {};
  const authorizationVersion = String(
    listing?.saleAuthorization?.version ??
      terms.authorizationVersion ??
      terms.version ??
      "",
  ).trim();
  const rawRecordOrdinal = terms.listingRecordOrdinal;
  const recordOrdinal =
    rawRecordOrdinal !== undefined &&
    rawRecordOrdinal !== null &&
    rawRecordOrdinal !== ""
      ? Number(rawRecordOrdinal)
      : authorizationVersion === WORK_AMO_V4_AUTH_VERSION
        ? 0
        : Number.NaN;
  return {
    blockHash: String(terms.listingBlockHash ?? "").trim().toLowerCase(),
    blockHeight: Number(terms.listingBlockHeight),
    blockTransactionIndex: Number(terms.listingBlockIndex),
    protocolVout: Number(terms.listingProtocolVout),
    recordOrdinal,
  };
}

function workMarketplaceDelta(kind, listing, record, registryOutputs) {
  const stateDelta = {
    baseContributions: [{
      field: "tokenMarketplaceFeeSats",
      value: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
    }],
    creditFixedSats: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
    economicOutputs: registryOutputs,
  };
  if (kind === "buy") {
    stateDelta.baseContributions.push({
      field: "tokenSaleVolumeSats",
      value: listing.priceSats.toString(),
    });
    stateDelta.creditFixedSats = (
      BigInt(stateDelta.creditFixedSats) + listing.priceSats
    ).toString();
    stateDelta.movement = {
      amountAtoms: listing.amountAtoms.toString(),
      identity: `sale:${record.txid}:${record.position.protocolVout}:${record.position.recordOrdinal}`,
    };
  }
  return stateDelta;
}

function evaluateWorkPwt(record, context, parsed) {
  const workState = cloneWorkState(context.workState);
  const senderAddress = firstAddressBearingInput(record);
  const claimed = claimedForTx(context.claimedByTxid, record.txid);
  const requiredSats =
    parsed.kind === "mint"
      ? WORK_AMO_V5_WORK_MINT_PAYMENT_SATS
      : WORK_AMO_V5_MIN_PAYMENT_SATS;
  const registry = singleRegistryClaim(record, claimed, {
    address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    attributedSats: requiredSats,
    requireBeforeProtocol: true,
    requiredSats,
    role: "pwt-token-registry",
  });
  if (!registry) {
    return invalidOutcome(
      "work-amo-v5-distinct-registry-payment-unavailable",
      parsed,
      genericSemanticKind(parsed.kind),
    );
  }
  const marketplace = ["list", "seal", "buy", "delist"].includes(
    parsed.kind,
  );
  if (
    marketplace &&
    context.protocolRecordCountsByTxid.get(
      `${record.txid}:pwt1`,
    ) !== 1
  ) {
    return invalidOutcome(
      "work-amo-v5-transaction-shape-invalid",
      parsed,
      genericSemanticKind(parsed.kind),
    );
  }
  const amountAtoms = BigInt(
    exactUnsignedText(parsed.amountAtoms, { positive: true }) || "0",
  );
  const derived = [];
  let genericState = context.genericState;
  let listing = null;
  let output = null;
  let sellerOutput = null;
  let stateDelta;
  if (parsed.kind === "mint") {
    if (
      !isWorkAmoV5LivenetAddress(senderAddress) ||
      amountAtoms !== 100_000_000_000n ||
      workState.confirmedSupplyAtoms + amountAtoms >
        WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK ||
      !adjustWorkBalance(
        workState,
        senderAddress,
        amountAtoms,
      )
    ) {
      return invalidOutcome(
        "work-amo-v5-raw-mint-state-invalid",
        parsed,
        "token-mint",
      );
    }
    workState.confirmedSupplyAtoms += amountAtoms;
    stateDelta = {
      baseContributions: [{
        field: "tokenMintFlowSats",
        value: String(WORK_AMO_V5_WORK_MINT_PAYMENT_SATS),
      }],
      creditFixedSats: String(WORK_AMO_V5_WORK_MINT_PAYMENT_SATS),
      economicOutputs: registry.outputs,
      movement: {
        amountAtoms: amountAtoms.toString(),
        identity: `mint:${record.txid}:${record.position.protocolVout}:${record.position.recordOrdinal}`,
      },
    };
    output = {
      amountAtoms: amountAtoms.toString(),
      recipientAddress: senderAddress,
      tokenId: WORK_TOKEN_ID,
    };
  } else if (parsed.kind === "send") {
    if (
      !isWorkAmoV5LivenetAddress(senderAddress) ||
      !isWorkAmoV5LivenetAddress(parsed.recipientAddress) ||
      amountAtoms <= 0n ||
      workSpendable(workState, senderAddress) < amountAtoms ||
      !adjustWorkBalance(workState, senderAddress, -amountAtoms) ||
      !adjustWorkBalance(
        workState,
        parsed.recipientAddress,
        amountAtoms,
      )
    ) {
      return invalidOutcome(
        "work-amo-v5-raw-transfer-state-invalid",
        parsed,
        "token-transfer",
      );
    }
    stateDelta = {
      baseContributions: [{
        field: "tokenTransferFlowSats",
        value: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
      }],
      creditFixedSats: String(WORK_AMO_V5_MIN_PAYMENT_SATS),
      economicOutputs: registry.outputs,
      movement: {
        amountAtoms: amountAtoms.toString(),
        identity: `transfer:${record.txid}:${record.position.protocolVout}:${record.position.recordOrdinal}`,
      },
    };
    output = {
      amountAtoms: amountAtoms.toString(),
      recipientAddress: parsed.recipientAddress,
      senderAddress,
      tokenId: WORK_TOKEN_ID,
    };
    const parent = context.incbParentsByTxid.get(record.txid);
    if (
      parent?.recipients?.some(
        (recipient) =>
          recipient.address === parsed.recipientAddress,
      )
    ) {
      const openingNetworkValueQ8 = BigInt(
        context.blockOpeningEconomicState.networkValueQ8,
      );
      const attachedWorkLiveValueAtSendQ8 =
        (amountAtoms * openingNetworkValueQ8) /
        WORK_AMO_V5_MOVEMENT_DENOMINATOR;
      const attachedWorkIssuanceUnits =
        attachedWorkLiveValueAtSendQ8 / WORK_AMO_VALUE_Q8_SCALE;
      genericState = cloneGenericState(context.genericState);
      if (
        !genericState.definitions.has(WORK_AMO_V5_INCB_TOKEN_ID) ||
        (attachedWorkIssuanceUnits > 0n &&
          !adjustGenericBalance(
            genericState,
            WORK_AMO_V5_INCB_TOKEN_ID,
            parsed.recipientAddress,
            attachedWorkIssuanceUnits,
          ))
      ) {
        return invalidOutcome(
          "work-amo-v5-incb-attachment-state-invalid",
          parsed,
          "token-transfer",
        );
      }
      if (attachedWorkIssuanceUnits > 0n) {
        genericState.supply.set(
          WORK_AMO_V5_INCB_TOKEN_ID,
          (genericState.supply.get(WORK_AMO_V5_INCB_TOKEN_ID) ?? 0n) +
            attachedWorkIssuanceUnits,
        );
      }
      const attachment = {
        amount: attachedWorkIssuanceUnits.toString(),
        attachedWorkAmountAtoms: amountAtoms.toString(),
        attachedWorkIssuanceUnits:
          attachedWorkIssuanceUnits.toString(),
        attachedWorkLiveValueAtSendQ8:
          attachedWorkLiveValueAtSendQ8.toString(),
        attachmentAppliedAtPosition: record.position,
        chargesTransactionFee: false,
        claimsEconomicOutputs: false,
        economicDelta: false,
        kind: "token-mint",
        matchedBondRecipientVouts: parent.recipients
          .filter(
            (recipient) =>
              recipient.address === parsed.recipientAddress,
          )
          .map((recipient) => recipient.vout)
          .sort((left, right) => left - right),
        parentPosition: parent.position,
        rawCandidate: false,
        recipientAddress: parsed.recipientAddress,
        tokenId: WORK_AMO_V5_INCB_TOKEN_ID,
        workSendPosition: record.position,
      };
      derived.push(attachment);
      output = { ...output, inceptionAttachment: attachment };
    }
  } else if (parsed.kind === "list") {
    const staticValidation = validateWorkAmoV5StaticAuthorization(
      parsed.saleAuthorization,
    );
    const authorization = staticValidation.authorization;
    const anchor = staticValidation.valid
      ? claimExactOutput(record, claimed, authorization.anchorVout)
      : null;
    if (
      !staticValidation.valid ||
      authorization.sellerAddress !== senderAddress ||
      authorization.anchorTxid ||
      authorization.anchorSignature ||
      workState.listings.has(record.txid) ||
      authorizationExpiredForRecord(authorization, record) ||
      !anchor ||
      anchor.amountSats !== authorization.anchorValueSats ||
      anchor.scriptPubKeyHex !== authorization.anchorScriptPubKey
    ) {
      return invalidOutcome(
        "work-amo-v5-raw-list-authorization-invalid",
        parsed,
        "token-listing",
      );
    }
    stateDelta = workMarketplaceDelta(
      "list",
      null,
      record,
      registry.outputs,
    );
    const hypothetical = applyEconomicDelta(
      context.economicState,
      stateDelta,
      { runtime: context.economicRuntime },
    );
    const derivedTerms = deriveWorkAmoV5FrozenTerms(authorization, {
      listingBondContributionQ8: hypothetical.bondContributionQ8,
      listingPosition: record.position,
      networkValueBeforeQ8: hypothetical.networkValueBeforeQ8,
      quote: context.economicState.quoteHead,
      spendableAmountAtoms: workSpendable(
        workState,
        authorization.sellerAddress,
      ).toString(),
    });
    if (!derivedTerms.valid) {
      return invalidOutcome(
        derivedTerms.reasonCode,
        parsed,
        "token-listing",
      );
    }
    listing = {
      amountAtoms: BigInt(derivedTerms.frozenTerms.unitAmountAtoms),
      frozenTerms: derivedTerms.frozenTerms,
      listingId: record.txid,
      priceSats: BigInt(derivedTerms.frozenTerms.unitPriceSats),
      saleAuthorization: authorization,
      sellerAddress: authorization.sellerAddress,
    };
    setWorkListing(workState, record.txid, listing);
    output = {
      frozenTerms: derivedTerms.frozenTerms,
      listing,
      workAmoPricing: derivedTerms,
    };
  } else {
    listing = workState.listings.get(parsed.listingId);
    if (!listing) {
      return invalidOutcome(
        "work-amo-v5-listing-unavailable",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    const position = listingPosition(listing);
    const referencedV4 =
      parsed.kind !== "delist" &&
      listing.saleAuthorization?.version === "pwt-sale-v4";
    let authorizationReady = true;
    if (referencedV4) {
      authorizationReady = validateWorkAmoV5ReferencedAuthorization(
        parsed.saleAuthorization,
        {
          listingAuthorization: listing.saleAuthorization,
          listingFrozenTerms: listing.frozenTerms,
        },
      ).valid;
    } else if (
      parsed.kind === "seal" ||
      (parsed.kind === "buy" && parsed.saleAuthorization)
    ) {
      authorizationReady = workAuthorizationsMatch(
        parsed.saleAuthorization,
        listing.saleAuthorization,
      );
    }
    if (
      authorizationReady &&
      ["seal", "buy"].includes(parsed.kind)
    ) {
      const signature = validateWorkAmoV5SaleTicketSignature({
        authorization: parsed.saleAuthorization,
        listingId: listing.listingId,
        network: "livenet",
        unitPriceSats: listing.priceSats.toString(),
      });
      authorizationReady =
        signature.valid === true &&
        parsed.saleAuthorization?.anchorTxid === listing.listingId;
    }
    const termsValidation =
      parsed.kind === "delist"
        ? { valid: true }
        : referencedV4
          ? {
              valid: workAmoCanonicalPositionPrecedes(
                position,
                record.position,
              ),
            }
          : validateWorkAmoV5SealOrBuyTerms({
            actionPosition: record.position,
            listingFrozenTerms: listing.frozenTerms,
            listingPosition: position,
            referencesListingFrozenTerms: true,
          });
    if (
      !authorizationReady ||
      !termsValidation.valid ||
      (parsed.kind === "delist" &&
        (senderAddress !== listing.sellerAddress ||
          !transactionSpends(
            record,
            listing.listingId,
            WORK_AMO_V5_LISTING_ANCHOR_VOUT,
          ))) ||
      (parsed.kind === "seal" &&
        senderAddress !== listing.sellerAddress)
    ) {
      return invalidOutcome(
        "work-amo-v5-raw-market-reference-invalid",
        parsed,
        genericSemanticKind(parsed.kind),
      );
    }
    stateDelta = workMarketplaceDelta(
      parsed.kind,
      listing,
      record,
      registry.outputs,
    );
    if (parsed.kind === "buy") {
      const authorization = listing.saleAuthorization ?? {};
      sellerOutput = smallestSingleClaim(record, claimed, {
        address: listing.sellerAddress,
        attributedSats: listing.priceSats.toString(),
        requireBeforeProtocol: true,
        requiredSats:
          listing.priceSats +
          BigInt(
            listing.saleAuthorization?.anchorValueSats ??
              WORK_AMO_V5_LISTING_ANCHOR_VALUE_SATS,
          ),
        role: "pwt-seller",
      });
      if (
        senderAddress !== parsed.buyerAddress ||
        (authorization.buyerAddress &&
          authorization.buyerAddress !== parsed.buyerAddress) ||
        authorizationExpiredForRecord(authorization, record) ||
        !transactionSpends(
          record,
          listing.listingId,
          WORK_AMO_V5_LISTING_ANCHOR_VOUT,
        ) ||
        !sellerOutput ||
        workBalance(workState, listing.sellerAddress) <
          listing.amountAtoms ||
        !adjustWorkBalance(
          workState,
          listing.sellerAddress,
          -listing.amountAtoms,
        ) ||
        !adjustWorkBalance(
          workState,
          parsed.buyerAddress,
          listing.amountAtoms,
        )
      ) {
        return invalidOutcome(
          "work-amo-v5-raw-buy-state-invalid",
          parsed,
          "token-sale",
        );
      }
      deleteWorkListing(workState, listing.listingId);
      stateDelta.economicOutputs.push(sellerOutput.output);
      output = {
        buyerAddress: parsed.buyerAddress,
        frozenTerms: listing.frozenTerms,
        listing,
      };
      derived.push({
        closedListing: listing,
        kind: "token-listing-closed",
        listingId: listing.listingId,
        tokenId: WORK_TOKEN_ID,
      });
    } else if (parsed.kind === "delist") {
      deleteWorkListing(workState, listing.listingId);
      output = { closedListing: listing };
    } else if (parsed.kind === "seal") {
      if (listing.saleAuthorization?.version !== "pwt-sale-v4") {
        const signed = validateWorkAmoV5StaticAuthorization(
          parsed.saleAuthorization,
        );
        if (!signed.valid) {
          return invalidOutcome(
            signed.reasonCode,
            parsed,
            "token-listing-sealed",
          );
        }
        listing = {
          ...listing,
          saleAuthorization: signed.authorization,
        };
        setWorkListing(workState, listing.listingId, listing);
      }
      output = {
        frozenTerms: listing.frozenTerms,
        listing,
      };
    }
  }
  return {
    claimed,
    derived,
    genericState,
    output,
    parsed,
    reasonCode: "",
    semanticKind: genericSemanticKind(parsed.kind),
    stateDelta: normalizeStateDelta(stateDelta),
    valid: true,
    workState,
  };
}

function evaluatePwt(record, context) {
  const parsed = parseWorkAmoV5RawPwtRecord(record.message);
  if (!parsed) {
    return invalidOutcome(
      "work-amo-v5-raw-pwt-record-invalid",
      null,
      "token-event-invalid",
    );
  }
  const parsedTokenId = normalizedTxid(
    parsed.tokenId ?? parsed.saleAuthorization?.tokenId,
  );
  const genericListing = parsed.listingId
    ? context.genericState.listings.get(parsed.listingId)
    : null;
  const workListing = parsed.listingId
    ? context.workState.listings.get(parsed.listingId)
    : null;
  return parsed.kind === "create" ||
    (parsedTokenId && parsedTokenId !== WORK_TOKEN_ID) ||
    (genericListing && !workListing)
    ? evaluateGenericPwt(record, context, parsed)
    : evaluateWorkPwt(record, context, parsed);
}

function evaluateRecord(record, context) {
  if (record.protocol === "pwa1") {
    return evaluatePwa(record, context);
  }
  if (record.protocol === "pwm1") {
    return evaluatePwm(record, context);
  }
  if (record.protocol === "pwid1") {
    return evaluatePwid(record, context);
  }
  if (record.protocol === "pwr1") {
    return evaluatePwr(record, context);
  }
  if (record.protocol === "pwt1") {
    return evaluatePwt(record, context);
  }
  return invalidOutcome(
    "work-amo-v5-raw-protocol-unsupported",
    null,
    "protocol-event-invalid",
  );
}

function canonicalRecord(record) {
  const txid = normalizedTxid(record?.txid);
  const position = normalizedPosition(record);
  const protocol = String(record?.protocol ?? "").trim().toLowerCase();
  const transactionMinerFeeSats = exactUnsignedText(
    record?.transactionMinerFeeSats,
  );
  const rawDecodeValid = record?.rawDecodeValid !== false;
  const rawDecodeReasonCode = String(
    record?.rawDecodeReasonCode ?? "",
  ).trim();
  if (
    !txid ||
    !position ||
    !["pwa1", "pwm1", "pwid1", "pwr1", "pwt1"].includes(protocol) ||
    !record?.tx ||
    !transactionMinerFeeSats ||
    (
      !rawDecodeValid &&
      ![
        CANONICAL_OP_RETURN_SCRIPT_MALFORMED,
        CANONICAL_OP_RETURN_UTF8_INVALID,
        CANONICAL_PWM_ENVELOPE_NONCONTIGUOUS,
      ].includes(rawDecodeReasonCode)
    )
  ) {
    throw new TypeError("work-amo-v5-raw-record-invalid");
  }
  return {
    ...record,
    message: String(record?.message ?? ""),
    position,
    protocol,
    rawDecodeReasonCode,
    rawDecodeValid,
    transactionMinerFeeSats,
    txid,
  };
}

function eventProjection(record, outcome) {
  return {
    ...projectionValue(outcome.output ?? {}),
    derived: projectionValue(outcome.derived ?? []),
    kind: outcome.semanticKind,
    parsed: projectionValue(outcome.parsed),
    position: record.position,
    protocol: record.protocol,
    reasonCode: outcome.reasonCode,
    txid: record.txid,
    valid: outcome.valid === true,
  };
}

function rawTransitionChainCommitment(preimage) {
  const commitment = workAmoV5CanonicalPayloadCommitment(preimage);
  return {
    model: WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
    payloadBytes: commitment.payloadBytes,
    sha256: commitment.sha256,
  };
}

function advanceRawTransitionChain(priorCommitment, transition) {
  return rawTransitionChainCommitment({
    model: WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
    priorCommitment,
    transition,
  });
}

function rawRecordWitnessCommitment(record, transactionWitness) {
  const rawRecordParts = Array.isArray(record.rawRecordParts)
    ? record.rawRecordParts
    : Array.isArray(record.payload?.rawRecordParts)
      ? record.payload.rawRecordParts
      : [];
  return workAmoV5CanonicalPayloadCommitment({
    message: record.message,
    payload: projectionValue(record.payload ?? null),
    position: record.position,
    protocol: record.protocol,
    rawDecodeReasonCode: record.rawDecodeReasonCode,
    rawDecodeValid: record.rawDecodeValid,
    rawRecordParts: projectionValue(rawRecordParts),
    transactionWitness,
    txid: record.txid,
  });
}

function rawRecordEvidenceMatches(actual, expected) {
  try {
    const actualCommitment =
      workAmoV5CanonicalPayloadCommitment(actual);
    const expectedCommitment =
      workAmoV5CanonicalPayloadCommitment(expected);
    return (
      actualCommitment.payloadBytes ===
        expectedCommitment.payloadBytes &&
      actualCommitment.sha256 === expectedCommitment.sha256
    );
  } catch {
    return false;
  }
}

function canonicalCoreBtcValueSats(value) {
  const text =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value.toFixed(8)
        : ""
      : String(value ?? "").trim();
  const match = /^([0-9]+)(?:\.([0-9]{0,8}))?$/u.exec(text);
  if (!match) {
    return null;
  }
  const sats =
    BigInt(match[1]) * 100_000_000n +
    BigInt((match[2] ?? "").padEnd(8, "0"));
  return sats <= 2_100_000_000_000_000n ? sats : null;
}

function canonicalTransactionOutputSats(output) {
  if (
    output?.scriptPubKey &&
    typeof output.scriptPubKey === "object" &&
    !Array.isArray(output.scriptPubKey)
  ) {
    return canonicalCoreBtcValueSats(output?.value);
  }
  const value = exactUnsignedText(
    output?.value ?? output?.amountSats ?? output?.outputSats,
  );
  const sats = value ? BigInt(value) : null;
  return sats !== null &&
    sats <= 2_100_000_000_000_000n
    ? sats
    : null;
}

function canonicalScriptAddress(scriptPubKeyHex) {
  try {
    return bitcoin.address.fromOutputScript(
      Buffer.from(scriptPubKeyHex, "hex"),
      bitcoin.networks.bitcoin,
    );
  } catch {
    return "";
  }
}

function exactTransactionOutputScript(output) {
  const sources = [
    output?.scriptPubKeyHex,
    output?.scriptPubKey?.hex,
    output?.scriptpubkey,
    output?.script_pub_key,
  ];
  const source = sources.find(
    (value) => typeof value === "string",
  );
  if (source === undefined) {
    return null;
  }
  const scriptPubKeyHex = source.trim().toLowerCase();
  return /^(?:[0-9a-f]{2})*$/u.test(scriptPubKeyHex)
    ? scriptPubKeyHex
    : null;
}

function transactionOutputWitness(output, vout) {
  const scriptPubKeyHex = exactTransactionOutputScript(output);
  const amountSats = canonicalTransactionOutputSats(output);
  const declaredVout =
    output?.n === undefined ? vout : exactSafeInteger(output.n);
  const derivedAddress =
    scriptPubKeyHex
      ? canonicalScriptAddress(scriptPubKeyHex)
      : "";
  if (
    scriptPubKeyHex === null ||
    amountSats === null ||
    declaredVout !== vout
  ) {
    throw new TypeError(
      "work-amo-v5-raw-transaction-output-witness-invalid",
    );
  }
  return {
    address: derivedAddress,
    amountSats: amountSats.toString(),
    scriptPubKeyHex,
    vout,
  };
}

function transactionOutputWitnesses(transaction) {
  if (!Array.isArray(transaction?.vout)) {
    throw new TypeError(
      "work-amo-v5-raw-transaction-output-witness-invalid",
    );
  }
  return transaction.vout.map(transactionOutputWitness);
}

function transactionInputOutpointWitnesses(transaction) {
  if (!Array.isArray(transaction?.vin) || transaction.vin.length === 0) {
    throw new TypeError(
      "work-amo-v5-raw-transaction-input-witness-invalid",
    );
  }
  return transaction.vin.map((input) => {
    if (typeof input?.coinbase === "string") {
      const coinbase = input.coinbase.trim().toLowerCase();
      if (!/^(?:[0-9a-f]{2})+$/u.test(coinbase)) {
        throw new TypeError(
          "work-amo-v5-raw-transaction-input-witness-invalid",
        );
      }
      return { coinbase };
    }
    const txid = normalizedTxid(input?.txid);
    const vout = exactSafeInteger(input?.vout);
    if (!txid || vout === null) {
      throw new TypeError(
        "work-amo-v5-raw-transaction-input-witness-invalid",
      );
    }
    return { txid, vout };
  });
}

function serializedTransactionWitness(transaction) {
  const rawHex = String(
    transaction?.hex ?? transaction?.rawHex ?? "",
  )
    .trim()
    .toLowerCase();
  if (!/^(?:[0-9a-f]{2})+$/u.test(rawHex)) {
    throw new TypeError(
      "work-amo-v5-raw-serialized-transaction-witness-invalid",
    );
  }
  let parsed;
  try {
    parsed = bitcoin.Transaction.fromHex(rawHex);
  } catch {
    throw new TypeError(
      "work-amo-v5-raw-serialized-transaction-witness-invalid",
    );
  }
  const txid = normalizedTxid(transaction?.txid);
  const parsedTxid = parsed.getId().toLowerCase();
  const parsedOutputs = parsed.outs.map((output, vout) => ({
    amountSats: BigInt(output.value).toString(),
    scriptPubKeyHex: Buffer.from(output.script).toString("hex"),
    vout,
  }));
  const envelopeOutputs = transactionOutputWitnesses(transaction).map(
    ({ amountSats, scriptPubKeyHex, vout }) => ({
      amountSats,
      scriptPubKeyHex,
      vout,
    }),
  );
  const parsedCoinbase = parsed.isCoinbase();
  const envelopeInputs =
    transactionInputOutpointWitnesses(transaction);
  const parsedInputs = parsedCoinbase
    ? [{
        coinbase: Buffer.from(parsed.ins[0].script).toString("hex"),
      }]
    : parsed.ins.map((input) => ({
        txid: Buffer.from(input.hash)
          .reverse()
          .toString("hex"),
        vout: input.index,
      }));
  if (
    !txid ||
    parsedTxid !== txid ||
    !rawRecordEvidenceMatches(parsedOutputs, envelopeOutputs) ||
    !rawRecordEvidenceMatches(parsedInputs, envelopeInputs)
  ) {
    throw new TypeError(
      "work-amo-v5-raw-serialized-transaction-witness-mismatch",
    );
  }
  return {
    parsedTransaction: parsed,
    rawHex,
    txid,
    witnessCommitment:
      workAmoV5CanonicalPayloadCommitment({
        inputs: parsedInputs,
        outputs: parsedOutputs,
        rawHex,
        txid,
      }),
  };
}

function transactionInputPrevoutWitnesses(transaction) {
  const outpoints = transactionInputOutpointWitnesses(transaction);
  return outpoints.map((outpoint, inputIndex) => {
    if (outpoint.coinbase) {
      return outpoint;
    }
    const prevout = transaction?.vin?.[inputIndex]?.prevout;
    if (!prevout) {
      throw new TypeError(
        "work-amo-v5-raw-transaction-prevout-witness-invalid",
      );
    }
    return {
      ...outpoint,
      prevout: transactionOutputWitness(prevout, outpoint.vout),
    };
  });
}

function canonicalInputPrevoutWitnessProjection(transaction) {
  return transactionInputPrevoutWitnesses(transaction).map(
    (input) =>
      input.coinbase
        ? { coinbase: input.coinbase }
        : {
            prevout: {
              amountSats: input.prevout.amountSats,
              scriptPubKeyHex: input.prevout.scriptPubKeyHex,
              vout: input.prevout.vout,
            },
            txid: input.txid,
            vout: input.vout,
          },
  );
}

function derivedTransactionMinerFeeSats(transaction) {
  const inputs = transactionInputPrevoutWitnesses(transaction);
  const coinbase = inputs.some((input) => input.coinbase);
  if (coinbase) {
    if (inputs.length !== 1 || !inputs[0].coinbase) {
      throw new TypeError(
        "work-amo-v5-raw-transaction-fee-witness-invalid",
      );
    }
    return "0";
  }
  let inputSats = 0n;
  for (const input of transaction.vin) {
    const value = canonicalTransactionOutputSats(input?.prevout);
    if (value === null) {
      throw new TypeError(
        "work-amo-v5-raw-transaction-fee-witness-invalid",
      );
    }
    inputSats += value;
  }
  const outputSats = transactionOutputWitnesses(transaction).reduce(
    (total, output) => total + BigInt(output.amountSats),
    0n,
  );
  if (inputSats < outputSats) {
    throw new TypeError(
      "work-amo-v5-raw-transaction-fee-witness-invalid",
    );
  }
  return (inputSats - outputSats).toString();
}

function doubleSha256(value) {
  return createHash("sha256")
    .update(
      createHash("sha256").update(value).digest(),
    )
    .digest();
}

function canonicalMerkleRootFromTxids(txids) {
  if (!Array.isArray(txids) || txids.length === 0) {
    return "";
  }
  let level = txids.map((txid) =>
    Buffer.from(txid, "hex").reverse()
  );
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(Buffer.from(level[level.length - 1]));
    }
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(
        doubleSha256(
          Buffer.concat([level[index], level[index + 1]]),
        ),
      );
    }
    level = next;
  }
  return Buffer.from(level[0]).reverse().toString("hex");
}

function canonicalMerkleRootFromInternalHashes(hashes) {
  if (!Array.isArray(hashes) || hashes.length === 0) {
    throw new TypeError(
      "work-amo-v5-raw-witness-merkle-root-invalid",
    );
  }
  let level = hashes.map((hash) => {
    const value = Buffer.from(hash);
    if (value.length !== 32) {
      throw new TypeError(
        "work-amo-v5-raw-witness-merkle-root-invalid",
      );
    }
    return value;
  });
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(Buffer.from(level[level.length - 1]));
    }
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(
        doubleSha256(
          Buffer.concat([level[index], level[index + 1]]),
        ),
      );
    }
    level = next;
  }
  return level[0];
}

function canonicalBip141BlockWitness(parsedTransactions) {
  if (
    !Array.isArray(parsedTransactions) ||
    parsedTransactions.length === 0 ||
    !parsedTransactions[0]?.isCoinbase() ||
    parsedTransactions
      .slice(1)
      .some((transaction) => transaction?.isCoinbase())
  ) {
    throw new TypeError(
      "work-amo-v5-raw-block-coinbase-invalid",
    );
  }
  const coinbase = parsedTransactions[0];
  const prefix = Buffer.from("6a24aa21a9ed", "hex");
  let commitmentOutput = null;
  for (let vout = 0; vout < coinbase.outs.length; vout += 1) {
    const script = Buffer.from(coinbase.outs[vout].script);
    if (
      script.length >= 38 &&
      script.subarray(0, prefix.length).equals(prefix)
    ) {
      commitmentOutput = {
        commitment: script.subarray(6, 38),
        scriptPubKeyHex: script.toString("hex"),
        vout,
      };
    }
  }
  const witnessTransactionCount = parsedTransactions.reduce(
    (count, transaction) =>
      count + (transaction.hasWitnesses() ? 1 : 0),
    0,
  );
  const required =
    witnessTransactionCount > 0 || commitmentOutput !== null;
  if (!required) {
    return {
      commitmentSha256: "",
      commitmentVout: null,
      model: WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
      required: false,
      witnessMerkleRootInternalHex: "",
      witnessTransactionCount: 0,
    };
  }
  if (!commitmentOutput) {
    throw new TypeError(
      "work-amo-v5-raw-witness-commitment-required",
    );
  }
  const coinbaseWitness = coinbase.ins[0]?.witness;
  if (
    !Array.isArray(coinbaseWitness) ||
    coinbaseWitness.length !== 1 ||
    coinbaseWitness[0]?.length !== 32
  ) {
    throw new TypeError(
      "work-amo-v5-raw-witness-reserved-value-invalid",
    );
  }
  const reservedValue = Buffer.from(coinbaseWitness[0]);
  const witnessMerkleRoot =
    canonicalMerkleRootFromInternalHashes(
      parsedTransactions.map((transaction, index) =>
        index === 0
          ? Buffer.alloc(32)
          : Buffer.from(transaction.getHash(true)),
      ),
    );
  const derivedCommitment = doubleSha256(
    Buffer.concat([witnessMerkleRoot, reservedValue]),
  );
  if (!derivedCommitment.equals(commitmentOutput.commitment)) {
    throw new TypeError(
      "work-amo-v5-raw-witness-commitment-mismatch",
    );
  }
  return {
    coinbaseWitnessReservedValueHex: reservedValue.toString("hex"),
    commitmentScriptPubKeyHex: commitmentOutput.scriptPubKeyHex,
    commitmentSha256: derivedCommitment.toString("hex"),
    commitmentVout: commitmentOutput.vout,
    model: WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
    required: true,
    witnessMerkleRootInternalHex: witnessMerkleRoot.toString("hex"),
    witnessTransactionCount,
  };
}

function canonicalBlockHeaderWitness(
  blockHeaderHex,
  blockHash,
  previousBlockHash,
  orderedTxids,
) {
  const normalizedHeader = String(blockHeaderHex ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{160}$/u.test(normalizedHeader)) {
    throw new TypeError(
      "work-amo-v5-raw-block-header-invalid",
    );
  }
  const header = Buffer.from(normalizedHeader, "hex");
  const derivedBlockHash =
    Buffer.from(doubleSha256(header)).reverse().toString("hex");
  const headerPreviousBlockHash =
    Buffer.from(header.subarray(4, 36))
      .reverse()
      .toString("hex");
  const headerMerkleRoot =
    Buffer.from(header.subarray(36, 68))
      .reverse()
      .toString("hex");
  const derivedMerkleRoot =
    canonicalMerkleRootFromTxids(orderedTxids);
  const blockTimeSeconds = header.readUInt32LE(68);
  if (
    derivedBlockHash !== blockHash ||
    headerPreviousBlockHash !== previousBlockHash ||
    headerMerkleRoot !== derivedMerkleRoot
  ) {
    throw new TypeError(
      "work-amo-v5-raw-block-header-witness-mismatch",
    );
  }
  return {
    blockHash: derivedBlockHash,
    blockTimeMs: blockTimeSeconds * 1_000,
    blockTimeSeconds,
    headerHex: normalizedHeader,
    merkleRoot: derivedMerkleRoot,
    previousBlockHash: headerPreviousBlockHash,
  };
}

function canonicalFullBlockEnvelope(
  blockTransactions,
  blockHeaderHex,
  blockHash,
  blockHeight,
  previousBlockHash,
) {
  if (
    !Array.isArray(blockTransactions) ||
    blockTransactions.length === 0
  ) {
    throw new TypeError(
      "work-amo-v5-raw-block-transactions-required",
    );
  }
  const transactionsByTxid = new Map();
  const expectedRecordsByKey = new Map();
  const candidateDescriptors = [];
  const orderedTxids = [];
  const parsedTransactions = [];
  let rawProtocolCandidateCount = 0;
  for (
    let blockTransactionIndex = 0;
    blockTransactionIndex < blockTransactions.length;
    blockTransactionIndex += 1
  ) {
    const transaction = blockTransactions[blockTransactionIndex];
    const txid = normalizedTxid(transaction?.txid);
    if (
      !txid ||
      transactionsByTxid.has(txid)
    ) {
      throw new TypeError(
        "work-amo-v5-raw-block-transaction-envelope-invalid",
      );
    }
    transactionOutputWitnesses(transaction);
    transactionInputOutpointWitnesses(transaction);
    const {
      parsedTransaction,
      ...serializedWitness
    } = serializedTransactionWitness(transaction);
    parsedTransactions.push(parsedTransaction);
    const reconstruction =
      canonicalRawProtocolRecordSetFromTransaction(
        transaction,
      );
    const transactionMinerFeeSats =
      reconstruction.records.length > 0
        ? derivedTransactionMinerFeeSats(transaction)
        : null;
    const transactionWitnessCommitment =
      reconstruction.records.length > 0
        ? workAmoV5CanonicalPayloadCommitment({
            blockTransactionIndex,
            inputPrevouts:
              canonicalInputPrevoutWitnessProjection(transaction),
            model: WORK_AMO_V5_RAW_TRANSACTION_WITNESS_MODEL,
            serializedTransactionWitnessCommitment:
              serializedWitness.witnessCommitment,
            transactionMinerFeeSats,
            txid,
          })
        : null;
    orderedTxids.push(txid);
    transactionsByTxid.set(txid, {
      blockTransactionIndex,
      reconstruction,
      transaction,
      transactionMinerFeeSats,
      transactionWitnessCommitment,
    });
    rawProtocolCandidateCount +=
      reconstruction.rawProtocolCandidateCount;
    for (const record of reconstruction.records) {
      const key = [
        txid,
        record.protocolVout,
        record.recordOrdinal,
      ].join(":");
      if (expectedRecordsByKey.has(key)) {
        throw new TypeError(
          "work-amo-v5-raw-block-transaction-envelope-invalid",
        );
      }
      expectedRecordsByKey.set(key, {
        ...record,
        blockTransactionIndex,
        txid,
      });
      candidateDescriptors.push({
        blockTransactionIndex,
        message: record.message,
        payload: record.payload,
        protocol: record.protocol,
        protocolVout: record.protocolVout,
        rawDecodeReasonCode: record.rawDecodeReasonCode,
        rawDecodeValid: record.rawDecodeValid,
        rawRecordParts: record.rawRecordParts,
        recordOrdinal: record.recordOrdinal,
        txid,
        transactionWitnessCommitment:
          transactionWitnessCommitment,
      });
    }
  }
  const candidateRecordSetCommitment =
    workAmoV5CanonicalPayloadCommitment(candidateDescriptors);
  const bip141Witness =
    canonicalBip141BlockWitness(parsedTransactions);
  const blockHeaderWitness = canonicalBlockHeaderWitness(
    blockHeaderHex,
    blockHash,
    previousBlockHash,
    orderedTxids,
  );
  const descriptor = {
    bip141Witness,
    blockHeaderWitness,
    blockHash,
    blockHeight,
    candidateRecordSetCommitment,
    candidateTransactionCount: new Set(
      candidateDescriptors.map((record) => record.txid),
    ).size,
    model: WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
    orderedTxids,
    protocolRecordCount: candidateDescriptors.length,
    rawProtocolCandidateCount,
    transactionCount: blockTransactions.length,
  };
  return {
    blockDescriptorCommitment:
      workAmoV5CanonicalPayloadCommitment(descriptor),
    blockDescriptorModel: WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
    bip141Witness,
    blockTimeMs: blockHeaderWitness.blockTimeMs,
    blockTransactionCount: blockTransactions.length,
    expectedRecordsByKey,
    rawProtocolCandidateCount,
    transactionsByTxid,
  };
}

function assertRawRecordTransactionParity(records, blockEnvelope) {
  if (
    records.length !== blockEnvelope.expectedRecordsByKey.size
  ) {
    throw new TypeError(
      "work-amo-v5-raw-transaction-record-set-mismatch",
    );
  }
  const unmatched = new Map(blockEnvelope.expectedRecordsByKey);
  for (const record of records) {
    const transactionEnvelope =
      blockEnvelope.transactionsByTxid.get(record.txid);
    const expected = unmatched.get([
      record.txid,
      record.position.protocolVout,
      record.position.recordOrdinal,
    ].join(":"));
    if (
      !transactionEnvelope ||
      !expected ||
      record.position.blockTransactionIndex !==
        transactionEnvelope.blockTransactionIndex ||
      record.protocol !== expected.protocol ||
      record.message !== expected.message ||
      record.rawDecodeValid !== expected.rawDecodeValid ||
      record.rawDecodeReasonCode !==
        expected.rawDecodeReasonCode ||
      !rawRecordEvidenceMatches(
        record.rawRecordParts,
        expected.rawRecordParts,
      ) ||
      !rawRecordEvidenceMatches(
        record.payload,
        expected.payload,
      ) ||
      (
        record.protocolVout !== undefined &&
        exactSafeInteger(record.protocolVout) !==
          expected.protocolVout
      ) ||
      (
        record.recordOrdinal !== undefined &&
        exactSafeInteger(record.recordOrdinal) !==
          expected.recordOrdinal
      )
    ) {
      throw new TypeError(
        "work-amo-v5-raw-record-transaction-witness-mismatch",
      );
    }
    const embeddedTxid = normalizedTxid(record.tx?.txid);
    if (
      embeddedTxid !== record.txid ||
      !rawRecordEvidenceMatches(
        transactionOutputWitnesses(record.tx),
        transactionOutputWitnesses(
          transactionEnvelope.transaction,
        ),
      ) ||
      !rawRecordEvidenceMatches(
        transactionInputPrevoutWitnesses(record.tx),
        transactionInputPrevoutWitnesses(
          transactionEnvelope.transaction,
        ),
      )
    ) {
      throw new TypeError(
        "work-amo-v5-raw-hydrated-transaction-witness-mismatch",
      );
    }
    if (
      record.transactionMinerFeeSats !==
        transactionEnvelope.transactionMinerFeeSats
    ) {
      throw new TypeError(
        "work-amo-v5-raw-transaction-fee-witness-mismatch",
      );
    }
    unmatched.delete([
      record.txid,
      expected.protocolVout,
      expected.recordOrdinal,
    ].join(":"));
  }
  if (unmatched.size !== 0) {
    throw new TypeError(
      "work-amo-v5-raw-transaction-record-set-mismatch",
    );
  }
}

function newlyClaimedVouts(before, after) {
  const prior = before instanceof Set ? before : new Set(before ?? []);
  return [...(after instanceof Set ? after : [])]
    .filter((vout) => !prior.has(vout))
    .sort((left, right) => left - right);
}

export function replayWorkAmoV5RawBlock({
  blockHeaderHex,
  blockTransactions,
  expectedBlockHash,
  expectedBlockHeight,
  expectedPreviousBlockHash,
  records,
  openingEconomicState,
  openingGenericState,
  openingIdState,
  openingWorkState,
} = {}) {
  const openingValidation = validateWorkAmoV5SufficientState(
    openingEconomicState,
  );
  if (!openingValidation.valid) {
    throw new TypeError(
      `work-amo-v5-raw-opening-economic-state-invalid:${openingValidation.reasonCode}`,
    );
  }
  const requiredBlockHash = normalizedTxid(expectedBlockHash);
  const requiredPreviousBlockHash =
    normalizedTxid(expectedPreviousBlockHash);
  const requiredBlockHeight = exactSafeInteger(expectedBlockHeight, {
    positive: true,
  });
  if (
    !requiredBlockHash ||
    !requiredPreviousBlockHash ||
    requiredBlockHeight === null ||
    requiredBlockHeight < WORK_AMO_V5_ACTIVATION_HEIGHT ||
    openingValidation.state.throughBlockHeight !==
      requiredBlockHeight - 1 ||
    openingValidation.state.throughBlockHash !==
      requiredPreviousBlockHash
  ) {
    throw new TypeError("work-amo-v5-raw-block-envelope-invalid");
  }
  const fullBlockEnvelope = canonicalFullBlockEnvelope(
    blockTransactions,
    blockHeaderHex,
    requiredBlockHash,
    requiredBlockHeight,
    requiredPreviousBlockHash,
  );
  const genericOpeningState = strictGenericStateFromProjection(
    openingGenericState,
    openingValidation.state.genericTokenStateCommitment,
  );
  const idOpeningState = strictIdStateFromProjection(
    openingIdState,
    openingValidation.state.idStateCommitment,
  );
  const workOpeningState = strictWorkStateFromProjection(
    openingWorkState,
    openingValidation.state.tokenStateCommitment,
  );
  const ordered = (Array.isArray(records) ? records : [])
    .map(canonicalRecord)
    .map((record) => ({
      ...record,
      canonicalBlockTimeMs: fullBlockEnvelope.blockTimeMs,
    }))
    .sort((left, right) =>
      comparePositions(left.position, right.position),
    );
  const positionKeys = new Set();
  const txidByBlockTransactionIndex = new Map();
  const blockTransactionIndexByTxid = new Map();
  const transactionWitnessByTxid = new Map(
    [...fullBlockEnvelope.transactionsByTxid]
      .filter(([, transaction]) =>
        Boolean(transaction.transactionWitnessCommitment),
      )
      .map(([txid, transaction]) => [
        txid,
        transaction.transactionWitnessCommitment,
      ]),
  );
  for (const record of ordered) {
    if (
      record.position.blockHeight !== requiredBlockHeight ||
      record.position.blockHash !== requiredBlockHash
    ) {
      throw new TypeError(
        "work-amo-v5-raw-record-outside-expected-block",
      );
    }
    const key = canonicalPositionKey(record.position);
    if (positionKeys.has(key)) {
      throw new TypeError("work-amo-v5-raw-position-duplicated");
    }
    positionKeys.add(key);
    const txidAtIndex = txidByBlockTransactionIndex.get(
      record.position.blockTransactionIndex,
    );
    if (txidAtIndex && txidAtIndex !== record.txid) {
      throw new TypeError(
        "work-amo-v5-raw-block-index-txid-conflict",
      );
    }
    txidByBlockTransactionIndex.set(
      record.position.blockTransactionIndex,
      record.txid,
    );
    const indexForTxid = blockTransactionIndexByTxid.get(record.txid);
    if (
      indexForTxid !== undefined &&
      indexForTxid !== record.position.blockTransactionIndex
    ) {
      throw new TypeError(
        "work-amo-v5-raw-txid-block-index-conflict",
      );
    }
    blockTransactionIndexByTxid.set(
      record.txid,
      record.position.blockTransactionIndex,
    );
    const embeddedTxid = normalizedTxid(record.tx?.txid);
    if (embeddedTxid && embeddedTxid !== record.txid) {
      throw new TypeError(
        "work-amo-v5-raw-record-txid-witness-conflict",
      );
    }
  }
  assertRawRecordTransactionParity(ordered, fullBlockEnvelope);
  const ordinalsByTransactionVout = new Map();
  for (const record of ordered) {
    const key = [
      record.txid,
      record.position.protocolVout,
    ].join(":");
    const ordinals = ordinalsByTransactionVout.get(key) ?? [];
    ordinals.push(record.position.recordOrdinal);
    ordinalsByTransactionVout.set(key, ordinals);
  }
  for (const ordinals of ordinalsByTransactionVout.values()) {
    ordinals.sort((left, right) => left - right);
    if (
      ordinals.some((ordinal, index) => ordinal !== index)
    ) {
      throw new TypeError(
        "work-amo-v5-raw-record-ordinal-set-incomplete",
      );
    }
  }
  const countsByTxid = new Map();
  const protocolRecordCountsByTxid = new Map();
  const validPwaRecordCountsByTxid = new Map();
  for (const record of ordered) {
    countsByTxid.set(
      record.txid,
      (countsByTxid.get(record.txid) ?? 0) + 1,
    );
    const protocolKey = `${record.txid}:${record.protocol}`;
    protocolRecordCountsByTxid.set(
      protocolKey,
      (protocolRecordCountsByTxid.get(protocolKey) ?? 0) + 1,
    );
    if (
      record.protocol === "pwa1" &&
      parseWorkAmoUsdQuoteRecord(record.message)
    ) {
      validPwaRecordCountsByTxid.set(
        record.txid,
        (validPwaRecordCountsByTxid.get(record.txid) ?? 0) + 1,
      );
    }
  }
  for (const record of ordered) {
    const declared = exactSafeInteger(
      record.transactionProtocolRecordCount,
      { positive: true },
    );
    if (declared !== countsByTxid.get(record.txid)) {
      throw new TypeError(
        "work-amo-v5-raw-transaction-record-count-invalid",
      );
    }
  }
  let economicState = structuredClone(openingValidation.state);
  const economicRuntime = createEconomicRuntime(economicState);
  let genericState = genericOpeningState;
  let idState = idOpeningState;
  let workState = workOpeningState;
  const blockOpeningEconomicState = {
    networkValueQ8: economicState.networkValueQ8,
  };
  const nextDerivedOrdinalByTransactionVout = new Map();
  for (const record of ordered) {
    const key = [
      record.txid,
      record.position.protocolVout,
    ].join(":");
    nextDerivedOrdinalByTransactionVout.set(
      key,
      Math.max(
        nextDerivedOrdinalByTransactionVout.get(key) ?? 0,
        record.position.recordOrdinal + 1,
      ),
    );
  }
  const claimedByTxid = new Map();
  const incbParentsByTxid = new Map();
  const outcomes = new Map();
  const events = [];
  const feeTransitions = [];
  const validTxids = new Set();
  const pwrCandidateSeenByTxid = new Set();
  const workSendsByTxid = new Map();
  let transitionChainCommitment = rawTransitionChainCommitment({
    block: {
      blockDescriptorCommitment:
        fullBlockEnvelope.blockDescriptorCommitment,
      blockDescriptorModel:
        fullBlockEnvelope.blockDescriptorModel,
      blockHash: requiredBlockHash,
      blockHeight: requiredBlockHeight,
      blockTransactionCount:
        fullBlockEnvelope.blockTransactionCount,
      previousBlockHash: requiredPreviousBlockHash,
      protocolRecordCount: ordered.length,
      transactionCount: countsByTxid.size,
    },
    model: WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
    openingStateCommitment:
      workAmoV5CanonicalStateCommitment(economicState),
  });
  for (let index = 0; index < ordered.length; index += 1) {
    const record = ordered[index];
    const claimedBefore = new Set(
      claimedByTxid.get(record.txid) ?? [],
    );
    const exactPwr =
      record.protocol === "pwr1"
        ? parseWorkAmoV5RawPwrRecord(record.message)
        : null;
    const duplicatePwr =
      Boolean(exactPwr) &&
      pwrCandidateSeenByTxid.has(record.txid);
    if (exactPwr) {
      pwrCandidateSeenByTxid.add(record.txid);
    }
    const outcome = record.rawDecodeValid === false
      ? invalidOutcome(
          record.rawDecodeReasonCode,
          null,
          "protocol-event-invalid",
        )
      : duplicatePwr
      ? invalidOutcome(
          "work-amo-v5-duplicate-pwr-record",
          exactPwr,
          "rush-mint",
        )
      : evaluateRecord(record, {
          blockOpeningEconomicState,
          claimedByTxid,
          economicState,
          economicRuntime,
          genericState,
          idState,
          incbParentsByTxid,
          protocolRecordCountsByTxid,
          validPwaRecordCountsByTxid,
          workSendsByTxid,
          workState,
        });
    const normalized = outcome.valid === true
      ? {
          ...outcome,
          reasonCode: "",
          stateDelta: normalizeStateDelta(outcome.stateDelta),
          valid: true,
        }
      : {
          ...invalidOutcome(
            String(
              outcome.reasonCode ??
                "work-amo-v5-raw-record-invalid",
            ),
            outcome.parsed,
            outcome.semanticKind,
          ),
          output: outcome.output ?? null,
        };
    const stateMutations = stateMutationProjection({
      genericCandidate: normalized.genericState,
      genericCurrent: genericState,
      idCandidate: normalized.idState,
      idCurrent: idState,
      workCandidate: normalized.workState,
      workCurrent: workState,
    });
    if (normalized.valid) {
      const applied = applyEconomicDelta(
        economicState,
        normalized.stateDelta,
        { mutate: true, runtime: economicRuntime },
      );
      economicState = applied.state;
      commitGenericState(genericState, normalized.genericState);
      commitIdState(idState, normalized.idState);
      commitWorkState(workState, normalized.workState);
      if (normalized.claimed) {
        claimedByTxid.set(record.txid, normalized.claimed);
      }
      if (
        record.protocol === "pwm1" &&
        normalized.parsed?.tokenFamily === "INCB"
      ) {
        incbParentsByTxid.set(record.txid, {
          position: record.position,
          recipients:
            normalized.output?.recipients ?? [],
        });
      }
      if (
        record.protocol === "pwt1" &&
        normalized.parsed?.kind === "send" &&
        normalized.output?.tokenId === WORK_TOKEN_ID
      ) {
        const sends = workSendsByTxid.get(record.txid) ?? [];
        sends.push({
          amountAtoms: normalized.output.amountAtoms,
          position: record.position,
          recipientAddress:
            normalized.output.recipientAddress,
        });
        workSendsByTxid.set(record.txid, sends);
      }
      validTxids.add(record.txid);
      normalized.networkValueBeforeQ8 =
        applied.networkValueBeforeQ8;
      normalized.networkValueAfterQ8 =
        applied.networkValueAfterQ8;
      normalized.bondContributionQ8 =
        applied.bondContributionQ8;
    } else {
      const networkValueQ8 = economicState.networkValueQ8;
      normalized.networkValueBeforeQ8 = networkValueQ8;
      normalized.networkValueAfterQ8 = networkValueQ8;
      normalized.bondContributionQ8 = "0";
    }
    const claimedAfter = normalized.valid
      ? normalized.claimed
      : claimedBefore;
    delete normalized.claimed;
    delete normalized.genericState;
    delete normalized.idState;
    delete normalized.workState;
    const derivedPositionKey = [
      record.txid,
      record.position.protocolVout,
    ].join(":");
    normalized.derived = (Array.isArray(normalized.derived)
      ? normalized.derived
      : []
    ).map((derived, derivedIndex) => {
      const derivedOrdinal =
        nextDerivedOrdinalByTransactionVout.get(
          derivedPositionKey,
        );
      nextDerivedOrdinalByTransactionVout.set(
        derivedPositionKey,
        derivedOrdinal + 1,
      );
      const projectionPosition = {
        ...record.position,
        recordOrdinal: derivedOrdinal,
      };
      return {
        ...derived,
        chargesTransactionFee: false,
        claimsEconomicOutputs: false,
        containerPosition: record.position,
        derivedId: [
          record.txid,
          projectionPosition.blockHeight,
          projectionPosition.blockTransactionIndex,
          projectionPosition.protocolVout,
          projectionPosition.recordOrdinal,
        ].join(":"),
        derivedIndex,
        materializationPosition:
          derived.attachmentAppliedAtPosition ?? record.position,
        economicDelta: false,
        projectionPosition,
        rawCandidate: false,
      };
    });
    normalized.derived = projectionValue(normalized.derived);
    normalized.output = projectionValue(normalized.output);
    normalized.parsed = projectionValue(normalized.parsed);
    normalized.projection = eventProjection(record, normalized);
    normalized.transition = normalized.valid
      ? normalized.stateDelta
      : null;
    const derivedForCommitment = structuredClone(
      normalized.derived ?? [],
    );
    transitionChainCommitment = advanceRawTransitionChain(
      transitionChainCommitment,
      {
        bondContributionQ8: normalized.bondContributionQ8,
        decode: {
          reasonCode: record.rawDecodeReasonCode,
          valid: record.rawDecodeValid,
        },
        derived: derivedForCommitment,
        kind: "protocol-event",
        networkValueAfterQ8: normalized.networkValueAfterQ8,
        networkValueBeforeQ8: normalized.networkValueBeforeQ8,
        newlyClaimedVouts: newlyClaimedVouts(
          claimedBefore,
          claimedAfter,
        ),
        output: normalized.output,
        position: record.position,
        protocol: record.protocol,
        rawRecordWitnessCommitment:
          rawRecordWitnessCommitment(
            record,
            transactionWitnessByTxid.get(record.txid),
          ),
        reasonCode: normalized.reasonCode,
        semanticKind: normalized.semanticKind,
        stateDelta: normalized.stateDelta,
        stateMutations,
        txid: record.txid,
        valid: normalized.valid,
      },
    );
    normalized.transitionChainCommitmentAfter =
      transitionChainCommitment;
    normalized.derived = normalized.derived.map((derived) => ({
      ...derived,
      parentTransitionChainCommitmentAfter:
        transitionChainCommitment,
    }));
    outcomes.set(recordKey(record), normalized);
    events.push({
      derived: structuredClone(normalized.derived ?? []),
      output: {
        ...(normalized.output ?? {}),
        projection: normalized.projection,
      },
      parsed: structuredClone(normalized.parsed),
      position: record.position,
      protocol: record.protocol,
      reasonCode: normalized.reasonCode,
      semanticKind: normalized.semanticKind,
      stateDelta: normalized.stateDelta,
      transitionChainCommitmentAfter:
        transitionChainCommitment,
      txid: record.txid,
      valid: normalized.valid,
    });

    const next = ordered[index + 1];
    if (next?.txid === record.txid) {
      continue;
    }
    const feeSats = BigInt(record.transactionMinerFeeSats);
    if (validTxids.has(record.txid)) {
      const applied = applyEconomicDelta(economicState, {
        creditFixedSats: feeSats.toString(),
      }, { mutate: true, runtime: economicRuntime });
      economicState = applied.state;
      const feeTransition = {
        creditFixedQ8Added: (
          feeSats * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE
        ).toString(),
        networkValueAfterQ8: applied.networkValueAfterQ8,
        networkValueBeforeQ8: applied.networkValueBeforeQ8,
        transactionMinerFeeSats: feeSats.toString(),
        txid: record.txid,
        valid: true,
      };
      transitionChainCommitment = advanceRawTransitionChain(
        transitionChainCommitment,
        { kind: "transaction-fee", ...feeTransition },
      );
      feeTransitions.push({
        ...feeTransition,
        transitionChainCommitmentAfter:
          transitionChainCommitment,
      });
    } else {
      const value = economicState.networkValueQ8;
      const feeTransition = {
        creditFixedQ8Added: "0",
        networkValueAfterQ8: value,
        networkValueBeforeQ8: value,
        reasonCode: "work-amo-v5-invalid-only-transaction",
        transactionMinerFeeSats: feeSats.toString(),
        txid: record.txid,
        valid: false,
      };
      transitionChainCommitment = advanceRawTransitionChain(
        transitionChainCommitment,
        { kind: "transaction-fee", ...feeTransition },
      );
      feeTransitions.push({
        ...feeTransition,
        transitionChainCommitmentAfter:
          transitionChainCommitment,
      });
    }
  }
  const publicGenericState = genericProjectionFromState(genericState);
  const publicIdState = idProjectionFromState(idState);
  const publicWorkState = workProjectionFromState(workState);
  const genericTokenStateCommitment =
    workAmoV5RawGenericStateCommitment(publicGenericState);
  const idStateCommitment =
    workAmoV5RawIdStateCommitment(publicIdState);
  const tokenStateCommitment =
    workAmoV5CanonicalTokenStateCommitment(publicWorkState);
  const closingValidation = validateWorkAmoV5SufficientState({
    ...economicState,
    genericTokenStateCommitment,
    idStateCommitment,
    networkValueQ8: economicValue(
      economicState,
      economicRuntime,
    ).networkValueQ8.toString(),
    throughBlockHash: requiredBlockHash,
    throughBlockHeight: requiredBlockHeight,
    tokenStateCommitment,
  });
  if (!closingValidation.valid) {
    throw new TypeError(
      `work-amo-v5-raw-closing-economic-state-invalid:${closingValidation.reasonCode}`,
    );
  }
  economicState = closingValidation.state;
  const stateCommitment =
    workAmoV5CanonicalStateCommitment(economicState);
  transitionChainCommitment = advanceRawTransitionChain(
    transitionChainCommitment,
    {
      closingStateCommitment: stateCommitment,
      genericTokenStateCommitment,
      idStateCommitment,
      kind: "block-close",
      tokenStateCommitment,
    },
  );
  return {
    bip141Witness: fullBlockEnvelope.bip141Witness,
    blockDescriptorCommitment:
      fullBlockEnvelope.blockDescriptorCommitment,
    blockDescriptorModel:
      fullBlockEnvelope.blockDescriptorModel,
    blockTimeMs: fullBlockEnvelope.blockTimeMs,
    blockTransactionCount:
      fullBlockEnvelope.blockTransactionCount,
    derivedEventCount: events.reduce(
      (count, event) => count + event.derived.length,
      0,
    ),
    economicState,
    events,
    feeTransitions,
    genericState: publicGenericState,
    genericTokenStateCommitment,
    idState: publicIdState,
    idStateCommitment,
    outcomes,
    protocolRecordCount: ordered.length,
    rawProtocolCandidateCount:
      fullBlockEnvelope.rawProtocolCandidateCount,
    records: ordered,
    stateCommitment,
    tokenStateCommitment,
    transitionChainCommitment,
    transitionChainModel: WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
    transactionCount: countsByTxid.size,
    workState: publicWorkState,
  };
}

function baseEventProjection(event) {
  return {
    blockHash: event.position.blockHash,
    blockHeight: event.position.blockHeight,
    blockIndex: event.position.blockTransactionIndex,
    confirmed: true,
    protocol: event.protocol,
    protocolVout: event.position.protocolVout,
    recordOrdinal: event.position.recordOrdinal,
    txid: event.txid,
    valid: event.valid,
  };
}

export function projectWorkAmoV5RawEvents(
  seedProjection,
  events,
  closingWorkState,
) {
  const seed =
    seedProjection &&
    typeof seedProjection === "object" &&
    !Array.isArray(seedProjection)
      ? seedProjection
      : {};
  const closing = normalizeWorkAmoV5RawWorkState(closingWorkState);
  const next = {
    ...seed,
    closedListings: structuredClone(
      Array.isArray(seed.closedListings) ? seed.closedListings : [],
    ),
    confirmedSupplyAtoms: closing.confirmedSupplyAtoms,
    holders: closing.holders.map((holder) => ({
      ...holder,
      balance: holder.balanceAtoms,
      tokenId: WORK_TOKEN_ID,
    })),
    invalidEvents: structuredClone(
      Array.isArray(seed.invalidEvents) ? seed.invalidEvents : [],
    ),
    listings: closing.listings.map((listing) => ({
      ...listing,
      amount: listing.amountAtoms,
      tokenId: WORK_TOKEN_ID,
    })),
    mints: structuredClone(Array.isArray(seed.mints) ? seed.mints : []),
    sales: structuredClone(Array.isArray(seed.sales) ? seed.sales : []),
    transfers: structuredClone(
      Array.isArray(seed.transfers) ? seed.transfers : [],
    ),
  };
  for (const event of Array.isArray(events) ? events : []) {
    if (event.protocol !== "pwt1") {
      continue;
    }
    const tokenId = normalizedTxid(
      event.parsed?.tokenId ??
        event.parsed?.saleAuthorization?.tokenId ??
        event.output?.projection?.listing?.saleAuthorization?.tokenId,
    );
    const workScoped =
      tokenId === WORK_TOKEN_ID ||
      event.output?.projection?.listing?.saleAuthorization?.tokenId ===
        WORK_TOKEN_ID;
    if (!workScoped) {
      continue;
    }
    const base = baseEventProjection(event);
    if (!event.valid) {
      next.invalidEvents.push({
        ...base,
        attemptedKind: event.parsed?.kind ?? "unknown",
        kind: "token-event-invalid",
        reasonCode: event.reasonCode,
        tokenId: WORK_TOKEN_ID,
      });
      continue;
    }
    const projection = event.output?.projection ?? {};
    if (event.parsed?.kind === "mint") {
      next.mints.push({
        ...base,
        amountAtoms: event.parsed.amountAtoms,
        minterAddress: projection.recipientAddress,
        paidSats: WORK_AMO_V5_WORK_MINT_PAYMENT_SATS,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      });
    } else if (event.parsed?.kind === "send") {
      next.transfers.push({
        ...base,
        amountAtoms: event.parsed.amountAtoms,
        paidSats: WORK_AMO_V5_MIN_PAYMENT_SATS,
        recipientAddress: event.parsed.recipientAddress,
        senderAddress: projection.senderAddress,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      });
    } else if (event.parsed?.kind === "buy") {
      next.sales.push({
        ...base,
        ...(projection.listing ?? {}),
        buyerAddress: projection.buyerAddress,
        amountAtoms: projection.listing?.amountAtoms,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      });
      if (projection.listing) {
        const derivedClose = (Array.isArray(event.derived)
          ? event.derived
          : []
        ).find(
          (derived) =>
            derived?.kind === "token-listing-closed" &&
            derived?.tokenId === WORK_TOKEN_ID,
        );
        const closeBase = derivedClose?.projectionPosition
          ? baseEventProjection({
              ...event,
              position: derivedClose.projectionPosition,
              protocol: "pwt1",
              valid: true,
            })
          : base;
        next.closedListings.push({
          ...projection.listing,
          ...closeBase,
          closedBlockHeight: closeBase.blockHeight,
          closedBlockIndex: closeBase.blockIndex,
          closedConfirmed: true,
          closedProtocolVout: closeBase.protocolVout,
          closedRecordOrdinal: closeBase.recordOrdinal,
          closedTxid: event.txid,
          tokenId: WORK_TOKEN_ID,
        });
      }
    } else if (event.parsed?.kind === "delist") {
      if (projection.closedListing) {
        next.closedListings.push({
          ...projection.closedListing,
          ...base,
          closedBlockHeight: base.blockHeight,
          closedBlockIndex: base.blockIndex,
          closedConfirmed: true,
          closedProtocolVout: base.protocolVout,
          closedRecordOrdinal: base.recordOrdinal,
          closedTxid: event.txid,
          tokenId: WORK_TOKEN_ID,
        });
      }
    }
  }
  return next;
}
