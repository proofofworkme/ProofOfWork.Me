import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  BOND_VALUE_Q8_SCALE,
  addIntegerTexts,
  canonicalIntegerText,
  decimalTextFromQ8,
  exactOrApproximateNumber,
  floorQ8PerUnit,
  integerBigInt,
  maxIntegerTexts,
  q8TextFromDecimal,
  q8TextFromIntegerUnits,
  safeIntegerNumber,
} from "../server/bond-units.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE,
  WORK_UNIT_SCALE_TEXT,
  formatWorkAtoms,
  isWorkTokenId,
  normalizeWorkAtoms,
  parseSignedWorkAmountToAtoms,
  parseWorkAmountToAtoms,
  withWorkPrecisionMetadata,
  workAmountAtomsFromRecord,
  workAmountFields,
} from "../server/work-units.mjs";
import {
  INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
  INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
  buildIncbRangeReplayWitnessManifest,
  canonicalIncbReplaySha256,
  incbRangeReplayWitnessBindingFields,
  incbRangeReplayWitnessMetaKey,
  incbReplayBondIdentity,
  incbReplaySnapshotFingerprint,
  normalizeIncbReplaySnapshotDescriptor,
} from "../server/incb-range-replay-witness.mjs";

const API_PATH = new URL("../server/proof-api.mjs", import.meta.url);
const APP_PATH = new URL("../src/App.tsx", import.meta.url);
const BACKFILL_PATH = new URL("./backfill-proof-indexer.mjs", import.meta.url);
const READER_PATH = new URL("../server/db/proof-index-reader.mjs", import.meta.url);
const SCHEMA_PATH = new URL("../server/sql/proof-indexer-v1.sql", import.meta.url);
const WORKER_PATH = new URL("./run-proof-indexer-worker.mjs", import.meta.url);

const sourceCache = new Map();
const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
const WORK_TOKEN_MAX_SUPPLY_ATOMS = 2_100_000_000_000_000n;
const WORK_TOKEN_MINT_AMOUNT_ATOMS = 100_000_000_000n;
const TOKEN_SEND_ATOMS_ACTION = "send2";
const TOKEN_SALE_AUTH_ATOMS_VERSION = "pwt-sale-v2";
const VALUE_Q8_SCALE = 100_000_000n;
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const BOND_TOKEN_IDS = new Set([POWB_TOKEN_ID, INCB_TOKEN_ID]);
const CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT = 958_383;
const PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL =
  "proof-indexer-pwt-range-replay-verifier-binding-v1";
const WORK_NETWORK_VALUE_ACCOUNTING_MODEL =
  "canonical-exact-work-network-q8-v1";
const GROWTH_ID_DENSITY_NUMERATOR = 26_868_933_906_745_133n;
const GROWTH_ID_DENSITY_DENOMINATOR = 100_000_000_000_000n;
const GROWTH_VALUE_MULTIPLE = 5n;
const DEFAULT_REPLAY_WITNESS_SET_HASH = "8".repeat(64);
const DEFAULT_REPLAY_WITNESSED_THROUGH_BLOCK = 958_500;
const DEFAULT_REPLAY_WITNESSED_THROUGH_BLOCK_HASH = "7".repeat(64);

function replayVerifierBindingFixture(overrides = {}) {
  const bindingId = String(overrides.bindingId ?? "6".repeat(64))
    .trim()
    .toLowerCase();
  const network = String(overrides.network ?? "livenet").trim().toLowerCase();
  return {
    bindingId,
    createdAt: "2026-07-18T00:00:00.000Z",
    model: PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
    network,
    rangeReplayFromHeight: CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT,
    witnessCount: 0,
    witnessModel: INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    witnessPreserveCount: 0,
    witnessSetHash: DEFAULT_REPLAY_WITNESS_SET_HASH,
    witnessSetMetaKey: incbRangeReplayWitnessMetaKey(network, bindingId),
    witnessedThroughBlock: DEFAULT_REPLAY_WITNESSED_THROUGH_BLOCK,
    witnessedThroughBlockHash:
      DEFAULT_REPLAY_WITNESSED_THROUGH_BLOCK_HASH,
    ...overrides,
  };
}
const ID_MARKETPLACE_MUTATION_KINDS = new Set([
  "id-list",
  "id-seal",
  "id-delist",
  "id-buy",
]);
const TOKEN_MARKETPLACE_MUTATION_KINDS = new Set([
  "token-listing",
  "token-listing-sealed",
  "token-listing-closed",
]);
const MARKETPLACE_MUTATION_KINDS = new Set([
  ...ID_MARKETPLACE_MUTATION_KINDS,
  ...TOKEN_MARKETPLACE_MUTATION_KINDS,
]);
const numericValue = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const dateIso = (value, fallback = new Date(0)) => {
  const date = value instanceof Date ? value : new Date(value ?? fallback);
  return Number.isNaN(date.getTime())
    ? fallback.toISOString()
    : date.toISOString();
};
const normalizedText = (value) => String(value ?? "").trim();
const normalizedTxid = (value) => {
  const txid = normalizedText(value).toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
};
const rowNumber = (row, key) => {
  const number = Number(row?.[key]);
  return Number.isFinite(number) ? number : 0;
};
const validTxid = (value) => Boolean(normalizedTxid(value));
const marketplaceMutationPaymentSats = (item) => {
  for (const value of [
    item?.marketplaceMutationFeeSats,
    item?.amountSats,
    item?.totalSats,
  ]) {
    const sats = numericValue(value);
    if (sats > 0) {
      return sats;
    }
  }
  return 0;
};
const proofFlowBigInt = (value) => {
  try {
    return integerBigInt(value, { allowZero: true }) ?? 0n;
  } catch {
    return 0n;
  }
};
const marketplaceMutationPaymentSatsBigInt = (item) => {
  for (const value of [
    item?.marketplaceMutationFeeSats,
    item?.amountSats,
    item?.totalSats,
  ]) {
    const sats = proofFlowBigInt(value);
    if (sats > 0n) {
      return sats;
    }
  }
  return 0n;
};
const marketplaceMutationPaymentIdentity = (item) => {
  const kind = String(item?.kind ?? "");
  if (!MARKETPLACE_MUTATION_KINDS.has(kind)) {
    return "";
  }
  const txid = String(item?.txid ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(txid)) {
    return "";
  }
  const family = ID_MARKETPLACE_MUTATION_KINDS.has(kind) ? "id" : "token";
  const registryAddress = String(
    item?.registryAddress ??
      item?.saleAuthorization?.registryAddress ??
      (family === "token" ? item?.counterparty : "") ??
      "",
  )
    .trim()
    .toLowerCase();
  return `${family}:${txid}:${registryAddress}`;
};
const uniqueMarketplaceMutationActivity = (
  activity,
  kinds = MARKETPLACE_MUTATION_KINDS,
) => {
  const unique = [];
  const indexByPayment = new Map();
  for (const item of Array.isArray(activity) ? activity : []) {
    if (!kinds.has(item?.kind)) {
      continue;
    }
    const identity = marketplaceMutationPaymentIdentity(item);
    if (!identity) {
      unique.push(item);
      continue;
    }
    const currentIndex = indexByPayment.get(identity);
    if (currentIndex === undefined) {
      indexByPayment.set(identity, unique.length);
      unique.push(item);
      continue;
    }
    if (
      marketplaceMutationPaymentSats(item) >
      marketplaceMutationPaymentSats(unique[currentIndex])
    ) {
      unique[currentIndex] = item;
    }
  }
  return unique;
};
const marketplaceMutationPaymentFlowSats = (
  activity,
  kinds = MARKETPLACE_MUTATION_KINDS,
) =>
  uniqueMarketplaceMutationActivity(activity, kinds).reduce(
    (total, item) => total + marketplaceMutationPaymentSats(item),
    0,
  );

const objectValue = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const workAtomicProjectionMetadata = (metadata) => {
  const item = objectValue(metadata);
  return (
    item.amountStorageModel === WORK_ATOMIC_PROJECTION_MODEL &&
    Number(item.decimals) === WORK_DECIMALS &&
    String(item.unitScale ?? "") === WORK_UNIT_SCALE_TEXT
  );
};
const workBalanceProjection = (value, metadata, { signed = false } = {}) => {
  const atoms = workAtomicProjectionMetadata(metadata)
    ? normalizeWorkAtoms(value, {
        allowNegative: signed,
        allowZero: true,
      })
    : signed
      ? parseSignedWorkAmountToAtoms(value)
      : parseWorkAmountToAtoms(value, { allowZero: true });
  return {
    amount: formatWorkAtoms(atoms, { allowNegative: signed }),
    atoms,
  };
};
const workAmountProjection = (
  record,
  { metadata = {}, storedAmount, storedAmountIsAtoms = false } = {},
) => {
  const amountAtoms =
    storedAmount !== undefined
      ? storedAmountIsAtoms || workAtomicProjectionMetadata(metadata)
        ? normalizeWorkAtoms(storedAmount)
        : parseWorkAmountToAtoms(storedAmount)
      : workAmountAtomsFromRecord(record);
  return {
    amount: formatWorkAtoms(amountAtoms),
    amountAtoms,
    decimals: WORK_DECIMALS,
    unitScale: WORK_UNIT_SCALE_TEXT,
  };
};
const workProjectionItem = (item) => {
  if (!isWorkTokenId(item?.tokenId)) {
    return item;
  }
  const authorization = objectValue(item?.saleAuthorization);
  if (
    [
      item?.amount,
      item?.amountAtoms,
      item?.tokenAmount,
      item?.tokenAmountAtoms,
      authorization.amount,
      authorization.amountAtoms,
    ].every((value) => value === undefined || value === null || value === "")
  ) {
    return item;
  }
  return { ...item, ...workAmountFields(item) };
};
const compareTokenHolderBalances = (left, right) => {
  if (isWorkTokenId(left?.tokenId) && isWorkTokenId(right?.tokenId)) {
    const leftAtoms = BigInt(String(left?.balanceAtoms ?? "0"));
    const rightAtoms = BigInt(String(right?.balanceAtoms ?? "0"));
    if (leftAtoms !== rightAtoms) {
      return leftAtoms > rightAtoms ? -1 : 1;
    }
  }
  return (
    Number(right?.balance ?? 0) - Number(left?.balance ?? 0) ||
    String(left?.address ?? "").localeCompare(String(right?.address ?? ""))
  );
};
const canonicalWorkAtomsText = (value, { allowZero = false } = {}) => {
  try {
    const normalized = normalizeWorkAtoms(value, { allowZero });
    const atoms = BigInt(normalized);
    return atoms <= WORK_TOKEN_MAX_SUPPLY_ATOMS ? normalized : "";
  } catch {
    return "";
  }
};
const canonicalNonNegativeIntegerText = (
  value,
  { allowZero = true } = {},
) => {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    return "";
  }
  const integer = BigInt(text);
  return allowZero || integer > 0n ? integer.toString() : "";
};
const workAtomsBigIntFromRecord = (
  record,
  { allowZero = false, storedAmountIsAtoms = false } = {},
) => {
  try {
    const atoms = workAmountAtomsFromRecord(record, {
      allowZero,
      storedAmountIsAtoms,
    });
    const normalized = canonicalWorkAtomsText(atoms, { allowZero });
    return normalized ? BigInt(normalized) : null;
  } catch {
    return null;
  }
};
const workAmountFieldsFromAtoms = (value, { allowZero = false } = {}) => {
  const normalized = canonicalWorkAtomsText(value, { allowZero });
  return normalized
    ? withWorkPrecisionMetadata({
        amount: formatWorkAtoms(normalized),
        amountAtoms: normalized,
      })
    : {};
};
const tokenLedgerAmountFromRecord = (
  tokenId,
  record,
  { allowZero = false, storedAmountIsAtoms = false } = {},
) => {
  if (isWorkTokenId(tokenId)) {
    return workAtomsBigIntFromRecord(record, {
      allowZero,
      storedAmountIsAtoms,
    });
  }
  if (BOND_TOKEN_IDS.has(String(tokenId ?? "").trim().toLowerCase())) {
    return integerBigInt(record?.amount ?? record ?? 0, { allowZero });
  }
  const amount = Number(record?.amount ?? record ?? 0);
  return Number.isSafeInteger(amount) &&
    (allowZero ? amount >= 0 : amount >= 1)
    ? amount
    : null;
};
const tokenLedgerAmountFields = (
  tokenId,
  amount,
  { allowZero = false } = {},
) =>
  isWorkTokenId(tokenId)
    ? workAmountFieldsFromAtoms(amount, { allowZero })
    : BOND_TOKEN_IDS.has(String(tokenId ?? "").trim().toLowerCase())
      ? { amount: canonicalIntegerText(amount, { allowZero }) }
      : { amount: Number(amount) };
const tokenLedgerZero = (tokenId) =>
  isWorkTokenId(tokenId) ||
  BOND_TOKEN_IDS.has(String(tokenId ?? "").trim().toLowerCase())
    ? 0n
    : 0;
const tokenLedgerHumanNumber = (tokenId, amount) =>
  isWorkTokenId(tokenId) ? Number(formatWorkAtoms(amount)) : Number(amount);
const tokenLedgerMaxSupply = (token) =>
  BOND_TOKEN_IDS.has(String(token?.tokenId ?? "").trim().toLowerCase())
    ? null
    : isWorkTokenId(token?.tokenId)
    ? WORK_TOKEN_MAX_SUPPLY_ATOMS
    : Number(token?.maxSupply ?? 0);
const tokenLedgerMintAmount = (token) =>
  BOND_TOKEN_IDS.has(String(token?.tokenId ?? "").trim().toLowerCase())
    ? integerBigInt(token?.mintAmount ?? 0)
    : isWorkTokenId(token?.tokenId)
    ? WORK_TOKEN_MINT_AMOUNT_ATOMS
    : Number(token?.mintAmount ?? 0);
const tokenSaleAuthorizationLedgerAmount = (authorization) => {
  if (authorization?.version === TOKEN_SALE_AUTH_ATOMS_VERSION) {
    const amountAtoms = canonicalWorkAtomsText(authorization.amountAtoms);
    return isWorkTokenId(authorization?.tokenId) && amountAtoms
      ? BigInt(amountAtoms)
      : null;
  }
  return tokenLedgerAmountFromRecord(
    authorization?.tokenId,
    authorization,
  );
};
const decimalValueToQ8 = (value) => {
  let text = String(value ?? "").trim();
  if (!/^[+]?[0-9]+(?:\.[0-9]+)?$/u.test(text)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      return null;
    }
    text = number.toFixed(8);
  }
  text = text.replace(/^\+/u, "");
  const [whole = "0", fractional = ""] = text.split(".");
  return BigInt(`${whole}${fractional.padEnd(8, "0").slice(0, 8)}`);
};
const q8ToCanonicalDecimal = (value) => {
  const q8 = BigInt(value);
  const sign = q8 < 0n ? "-" : "";
  const absolute = q8 < 0n ? -q8 : q8;
  const whole = absolute / VALUE_Q8_SCALE;
  const fractional = absolute % VALUE_Q8_SCALE;
  return fractional === 0n
    ? `${sign}${whole}`
    : `${sign}${whole}.${fractional
        .toString()
        .padStart(8, "0")
        .replace(/0+$/u, "")}`;
};
const q8ToNumber = (value) => Number(q8ToCanonicalDecimal(value));
const frontendNormalizeTokenTicker = (value) =>
  String(value ?? "").trim().toUpperCase();
const frontendExactIntegerBigInt = (value, options = {}) => {
  if (typeof value === "bigint") {
    return options.signed || value >= 0n ? value : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && (options.signed || value >= 0)
      ? BigInt(value)
      : null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  const pattern = options.signed ? /^-?(?:0|[1-9]\d*)$/u : /^(?:0|[1-9]\d*)$/u;
  return pattern.test(text) ? BigInt(text) : null;
};
const frontendExactIntegerNumber = (value) => {
  const exact = frontendExactIntegerBigInt(value);
  if (exact !== null) return Number(exact);
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
};
const frontendCompareExactIntegers = (left, right) => {
  const leftExact = frontendExactIntegerBigInt(left, { signed: true });
  const rightExact = frontendExactIntegerBigInt(right, { signed: true });
  if (leftExact !== null && rightExact !== null) {
    return leftExact < rightExact ? -1 : leftExact > rightExact ? 1 : 0;
  }
  return frontendExactIntegerNumber(left) - frontendExactIntegerNumber(right);
};
const frontendIsBondTokenDefinition = (token) => {
  const tokenId = String(token?.tokenId ?? "").trim().toLowerCase();
  const ticker = frontendNormalizeTokenTicker(token?.ticker);
  return BOND_TOKEN_IDS.has(tokenId) || ticker === "POWB" || ticker === "INCB";
};
const frontendIsWorkToken = (token) =>
  String(token?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID ||
  frontendNormalizeTokenTicker(token?.ticker) === "WORK";
const frontendWorkRecordAtoms = (amount, amountAtoms) => {
  const explicitAtoms = String(amountAtoms ?? "").trim();
  if (/^(?:0|[1-9][0-9]*)$/u.test(explicitAtoms)) {
    return BigInt(explicitAtoms);
  }
  const legacyWholeAmount = String(amount ?? "").trim();
  return /^(?:0|[1-9][0-9]*)$/u.test(legacyWholeAmount)
    ? BigInt(legacyWholeAmount) * WORK_UNIT_SCALE
    : null;
};
const frontendWorkNumberFromAtoms = (value) =>
  Number(formatWorkAtoms(value));
const frontendTokenRecordAmountAtoms = (token, amount, amountAtoms) =>
  frontendIsWorkToken(token)
    ? frontendWorkRecordAtoms(amount, amountAtoms)
    : Number.isSafeInteger(Number(amount)) && Number(amount) >= 0
      ? BigInt(Number(amount))
      : null;
const workAtomsValueAtNetworkQ8 = (
  amountAtoms,
  networkValue,
  exactNetworkValueQ8 = "",
) => {
  const exact = canonicalNonNegativeIntegerText(exactNetworkValueQ8);
  const value = exact ? BigInt(exact) : decimalValueToQ8(networkValue);
  return value === null
    ? null
    : (BigInt(amountAtoms) * value) /
        (21_000_000n * 100_000_000n);
};
const workAtomsValueAtFloorQ8 = (amountAtoms, floorValue) => {
  const value = decimalValueToQ8(floorValue);
  return value === null
    ? null
    : (BigInt(amountAtoms) * value) / 100_000_000n;
};

function fileSource(path) {
  const key = path.href;
  if (!sourceCache.has(key)) {
    sourceCache.set(key, readFileSync(path, "utf8"));
  }
  return sourceCache.get(key);
}

function topLevelFunctionSource(path, name) {
  const source = fileSource(path);
  const startPattern = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}(?:<[^>]+>)?\\s*\\(`,
    "mu",
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Could not find ${name} in ${path.pathname}`);
  }
  const rest = source.slice(startMatch.index + startMatch[0].length);
  const nextMatch = /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/mu.exec(
    rest,
  );
  const end = nextMatch
    ? startMatch.index + startMatch[0].length + nextMatch.index
    : source.length;
  return source.slice(startMatch.index, end).trim().replace(/^export\s+/u, "");
}

function isolatedFunction(path, name, globals = {}) {
  const scopedBondTokenIds =
    globals.BOND_TOKEN_IDS instanceof Set ? globals.BOND_TOKEN_IDS : BOND_TOKEN_IDS;
  const scopedIsBondTokenId = (tokenId) =>
    scopedBondTokenIds.has(String(tokenId ?? "").trim().toLowerCase());
  const scopedBondUnitsBigInt = (value, { allowZero = false } = {}) => {
    try {
      return integerBigInt(value, { allowZero });
    } catch {
      return null;
    }
  };
  const scopedExactBondUnits = (
    value,
    { positive = false, signed = false } = {},
  ) =>
    canonicalIntegerText(value, {
      allowNegative: signed,
      allowZero: !positive,
    });
  const scopedTokenLedgerAmountFromRecord = (
    tokenId,
    record,
    { allowZero = false, storedAmountIsAtoms = false } = {},
  ) => {
    if (isWorkTokenId(tokenId)) {
      return workAtomsBigIntFromRecord(record, {
        allowZero,
        storedAmountIsAtoms,
      });
    }
    if (scopedIsBondTokenId(tokenId)) {
      return scopedBondUnitsBigInt(record?.amount ?? record ?? 0, { allowZero });
    }
    const amount = Number(record?.amount ?? record ?? 0);
    return Number.isSafeInteger(amount) &&
      (allowZero ? amount >= 0 : amount >= 1)
      ? amount
      : null;
  };
  const scopedTokenLedgerAmountFields = (
    tokenId,
    amount,
    { allowZero = false } = {},
  ) => {
    if (isWorkTokenId(tokenId)) {
      return workAmountFieldsFromAtoms(amount, { allowZero });
    }
    if (scopedIsBondTokenId(tokenId)) {
      const normalized = canonicalIntegerText(amount, { allowZero });
      return normalized ? { amount: normalized } : {};
    }
    return { amount: Number(amount) };
  };
  const scopedTokenLedgerMaxSupply = (token) =>
    scopedIsBondTokenId(token?.tokenId)
      ? null
      : isWorkTokenId(token?.tokenId)
        ? WORK_TOKEN_MAX_SUPPLY_ATOMS
        : Number(token?.maxSupply ?? 0);
  const scopedTokenLedgerMintAmount = (token) =>
    scopedIsBondTokenId(token?.tokenId)
      ? scopedBondUnitsBigInt(token?.mintAmount ?? 0)
      : isWorkTokenId(token?.tokenId)
        ? WORK_TOKEN_MINT_AMOUNT_ATOMS
        : Number(token?.mintAmount ?? 0);
  const scopedCanonicalPwtReplayVerifierBindingDescriptor = (
    value,
    network,
  ) => {
    const binding =
      value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const bindingId = String(binding.bindingId ?? "").trim().toLowerCase();
    const createdAt = String(binding.createdAt ?? "").trim();
    const rangeReplayFromHeight = Number(binding.rangeReplayFromHeight);
    const witnessCount = Number(binding.witnessCount);
    const witnessModel = String(binding.witnessModel ?? "").trim();
    const witnessPreserveCount = Number(binding.witnessPreserveCount);
    const witnessSetHash = String(binding.witnessSetHash ?? "")
      .trim()
      .toLowerCase();
    const witnessSetMetaKey = String(binding.witnessSetMetaKey ?? "").trim();
    const witnessedThroughBlock = Number(binding.witnessedThroughBlock);
    const witnessedThroughBlockHash = String(
      binding.witnessedThroughBlockHash ?? "",
    )
      .trim()
      .toLowerCase();
    let expectedWitnessSetMetaKey = "";
    try {
      expectedWitnessSetMetaKey = incbRangeReplayWitnessMetaKey(
        network,
        bindingId,
      );
    } catch {
      expectedWitnessSetMetaKey = "";
    }
    if (
      binding.model !== PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL ||
      binding.network !== network ||
      !/^[0-9a-f]{64}$/u.test(bindingId) ||
      !Number.isFinite(Date.parse(createdAt)) ||
      !Number.isSafeInteger(rangeReplayFromHeight) ||
      rangeReplayFromHeight !==
        CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT ||
      witnessModel !== INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL ||
      !/^[0-9a-f]{64}$/u.test(witnessSetHash) ||
      !expectedWitnessSetMetaKey ||
      witnessSetMetaKey !== expectedWitnessSetMetaKey ||
      !Number.isSafeInteger(witnessCount) ||
      witnessCount < 0 ||
      !Number.isSafeInteger(witnessPreserveCount) ||
      witnessPreserveCount < 0 ||
      witnessPreserveCount > witnessCount ||
      !Number.isSafeInteger(witnessedThroughBlock) ||
      witnessedThroughBlock < rangeReplayFromHeight - 1 ||
      !/^[0-9a-f]{64}$/u.test(witnessedThroughBlockHash)
    ) {
      return null;
    }
    return {
      bindingId,
      createdAt,
      model: PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
      network,
      rangeReplayFromHeight,
      witnessCount,
      witnessModel,
      witnessPreserveCount,
      witnessSetHash,
      witnessSetMetaKey,
      witnessedThroughBlock,
      witnessedThroughBlockHash,
    };
  };
  const scopedCanonicalPwtReplayVerifierBindingsEqual = (left, right) =>
    Boolean(
      left &&
        right &&
        [
          "bindingId",
          "createdAt",
          "model",
          "network",
          "rangeReplayFromHeight",
          "witnessCount",
          "witnessModel",
          "witnessPreserveCount",
          "witnessSetHash",
          "witnessSetMetaKey",
          "witnessedThroughBlock",
          "witnessedThroughBlockHash",
        ].every((field) => left[field] === right[field]),
    );
  const scopedCanonicalPwtReplayVerifierBindingCacheKey = (
    value,
    network,
  ) => {
    const binding = scopedCanonicalPwtReplayVerifierBindingDescriptor(
      value,
      network,
    );
    return binding
      ? `:replay:${binding.bindingId}:from${binding.rangeReplayFromHeight}:at${Date.parse(binding.createdAt)}` +
        `:witness:${binding.witnessModel}:${binding.witnessSetHash}` +
        `:${binding.witnessCount}:${binding.witnessPreserveCount}` +
        `:through${binding.witnessedThroughBlock}:${binding.witnessedThroughBlockHash}`
      : "";
  };
  const context = vm.createContext({
    URLSearchParams,
    APPLY_WORK_ATOMIC_MIGRATION: false,
    AUDIT_WORK_ATOMS_ONLY: false,
    CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
    MIGRATE_WORK_ATOMS_ONLY: false,
    RUSH_BOOTSTRAP_ONLY: false,
    VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY: false,
    console: {
      error() {},
      log() {},
      warn() {},
    },
    WORK_ATOMIC_PROJECTION_MODEL,
    WORK_DECIMALS,
    WORK_TOKEN_ID,
    WORK_TOKEN_MAX_SUPPLY,
    WORK_UNIT_SCALE,
    WORK_UNIT_SCALE_TEXT,
    WORK_TOKEN_MAX_SUPPLY_ATOMS,
    WORK_TOKEN_MINT_AMOUNT_ATOMS,
    GROWTH_ID_DENSITY_DENOMINATOR,
    GROWTH_ID_DENSITY_NUMERATOR,
    GROWTH_VALUE_MULTIPLE,
    TOKEN_SEND_ATOMS_ACTION,
    TOKEN_SALE_AUTH_ATOMS_VERSION,
    VALUE_Q8_SCALE,
    BOND_VALUE_Q8_SCALE,
    BOND_TOKEN_IDS: scopedBondTokenIds,
    CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT,
    INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
    INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
    activePwtRangeReplay: () => false,
    activatePwtRangeReplayVerifierBinding: () => null,
    assertCanonicalPwtRangeReplayState: () => null,
    assertInternalReplayVerifierResponseBinding: (payload) => payload,
    ID_MARKETPLACE_MUTATION_KINDS,
    MARKETPLACE_MUTATION_KINDS,
    TOKEN_MARKETPLACE_MUTATION_KINDS,
    addIntegerTexts,
    bondUnitsBigInt: scopedBondUnitsBigInt,
    canonicalIncbReplaySha256,
    buildIncbRangeReplayWitnessManifest,
    canonicalIntegerText,
    canonicalPwtReplayVerifierBindingCacheKey:
      scopedCanonicalPwtReplayVerifierBindingCacheKey,
    canonicalPwtReplayVerifierBindingDescriptor:
      scopedCanonicalPwtReplayVerifierBindingDescriptor,
    canonicalPwtReplayVerifierBindingsEqual:
      scopedCanonicalPwtReplayVerifierBindingsEqual,
    canonicalRebuildTrustState: (rebuild, network) => {
      if (rebuild?.network && rebuild.network !== network) return "invalid";
      if (
        rebuild?.active === true &&
        rebuild?.complete !== true &&
        rebuild?.status === "active"
      ) return "active";
      if (
        rebuild?.active === false &&
        rebuild?.complete !== false &&
        rebuild?.status === "complete"
      ) return "complete";
      return "invalid";
    },
    canonicalNonNegativeIntegerText,
    canonicalWorkAtomsText,
    compareTokenHolderBalances,
    dateIso,
    decimalTextFromQ8,
    decimalValueToQ8,
    exactOrApproximateNumber,
    exactBondUnits: scopedExactBondUnits,
    floorQ8PerUnit,
    formatWorkAtoms,
    incbRangeReplayWitnessMetaKey,
    incbRangeReplayWitnessBindingFields,
    incbReplayBondIdentity,
    incbReplaySnapshotFingerprint,
    integerBigInt,
    isBondTokenId: scopedIsBondTokenId,
    isWorkTokenId,
    maxIntegerTexts,
    marketplaceMutationPaymentFlowSats,
    marketplaceMutationPaymentIdentity,
    marketplaceMutationPaymentSats,
    marketplaceMutationPaymentSatsBigInt,
    normalizeWorkAtoms,
    normalizedText,
    normalizedTxid,
    numericValue,
    normalizeIncbReplaySnapshotDescriptor,
    objectValue,
    parseSignedWorkAmountToAtoms,
    parseWorkAmountToAtoms,
    proofFlowBigInt,
    q8ToCanonicalDecimal,
    q8ToNumber,
    q8TextFromDecimal,
    q8TextFromIntegerUnits,
    rowNumber,
    safeIntegerNumber,
    tokenLedgerAmountFields: scopedTokenLedgerAmountFields,
    tokenLedgerAmountFromRecord: scopedTokenLedgerAmountFromRecord,
    tokenLedgerHumanNumber,
    tokenLedgerApproximateNumber: tokenLedgerHumanNumber,
    tokenLedgerBalanceFields: (tokenId, balance) =>
      isWorkTokenId(tokenId)
        ? withWorkPrecisionMetadata({
            balance: formatWorkAtoms(balance),
            balanceAtoms: String(balance),
            amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
          })
        : scopedIsBondTokenId(tokenId)
          ? { balance: canonicalIntegerText(balance, { allowZero: true }) }
          : { balance: Number(balance) },
    tokenLedgerMaxSupply: scopedTokenLedgerMaxSupply,
    tokenLedgerMintAmount: scopedTokenLedgerMintAmount,
    tokenLedgerSupplyValue: (tokenId, amount) =>
      isWorkTokenId(tokenId)
        ? formatWorkAtoms(amount)
        : scopedIsBondTokenId(tokenId)
          ? canonicalIntegerText(amount, { allowZero: true })
          : Number(amount),
    tokenLedgerZero: (tokenId) =>
      isWorkTokenId(tokenId) || scopedIsBondTokenId(tokenId) ? 0n : 0,
    tokenSaleAuthorizationLedgerAmount,
    workAmountAtomsFromRecord,
    workAtomicProjectionMetadata,
    workAmountProjection,
    workBalanceProjection,
    workAtomsBigIntFromRecord,
    workAtomsValueAtFloorQ8,
    workAtomsValueAtNetworkQ8,
    workAtomicProjectionReady: async () => true,
    workAmountFieldsFromAtoms,
    workProjectionItem,
    withWorkPrecisionMetadata,
    uniqueMarketplaceMutationActivity,
    validTxid,
    ...globals,
  });
  const definition = topLevelFunctionSource(path, name);
  new vm.Script(`${definition}\nthis.__checkedFunction = ${name};`, {
    filename: path.pathname,
  }).runInContext(context);
  return context.__checkedFunction;
}

function isolatedExactWorkNetworkValueSummaryBinding() {
  const canonicalNonNegativeQ8Text = isolatedFunction(
    BACKFILL_PATH,
    "canonicalNonNegativeQ8Text",
  );
  return isolatedFunction(
    BACKFILL_PATH,
    "exactWorkNetworkValueSummaryBinding",
    {
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      canonicalNonNegativeQ8Text,
      decimalTextFromQ8,
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
    },
  );
}

function exactWorkFloorFixture(
  workNetworkValueQ8 = "3975162634405565000000000",
  actualValue = {},
) {
  const networkQ8 = BigInt(workNetworkValueQ8);
  const workNetworkValueSats = decimalTextFromQ8(workNetworkValueQ8);
  const floorQ8 = (networkQ8 / BigInt(WORK_TOKEN_MAX_SUPPLY)).toString();
  const floorSats = decimalTextFromQ8(floorQ8);
  const exactFields = {
    baseNetworkValueQ8: workNetworkValueQ8,
    baseNetworkValueSats: workNetworkValueSats,
    baseTotalQ8: workNetworkValueQ8,
    baseTotalSats: workNetworkValueSats,
    floorQ8,
    floorSats,
    frozenFloorQ8: floorQ8,
    frozenFloorSats: floorSats,
    frozenNetworkValueQ8: workNetworkValueQ8,
    frozenNetworkValueSats: workNetworkValueSats,
    frozenTotalQ8: workNetworkValueQ8,
    frozenTotalSats: workNetworkValueSats,
    liveFloorQ8: floorQ8,
    liveFloorSats: floorSats,
    liveNetworkValueQ8: workNetworkValueQ8,
    liveNetworkValueSats: workNetworkValueSats,
    liveTotalQ8: workNetworkValueQ8,
    liveTotalSats: workNetworkValueSats,
    networkValueQ8: workNetworkValueQ8,
    networkValueSats: workNetworkValueSats,
    totalQ8: workNetworkValueQ8,
    totalSats: workNetworkValueSats,
  };
  return {
    actualValue: {
      ...actualValue,
      ...exactFields,
      workNetworkValueAccountingModel:
        WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    },
    ...exactFields,
    workNetworkValueAccountingModel:
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
  };
}

function exactSummaryTotalsFixture(workNetworkValueQ8) {
  const workNetworkValueSats = decimalTextFromQ8(workNetworkValueQ8);
  return {
    growthActualValueQ8: workNetworkValueQ8,
    growthActualValueSats: workNetworkValueSats,
    growthWorkFloorValueQ8: workNetworkValueQ8,
    growthWorkFloorValueSats: workNetworkValueSats,
    workActualValueQ8: workNetworkValueQ8,
    workActualValueSats: workNetworkValueSats,
    workNetworkValueAccountingModel:
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    workNetworkValueQ8,
    workNetworkValueSats,
  };
}

function exactCanonicalSummaryRowValueFixture(
  workNetworkValueQ8,
  actualValue = {},
) {
  const floor = exactWorkFloorFixture(workNetworkValueQ8, actualValue);
  return {
    totals_growth_actual_value_q8: workNetworkValueQ8,
    totals_growth_work_floor_value_q8: workNetworkValueQ8,
    totals_work_actual_value_q8: workNetworkValueQ8,
    totals_work_network_value_model:
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    totals_work_network_value_q8: workNetworkValueQ8,
    work_actual_live_network_value_q8: workNetworkValueQ8,
    work_actual_live_total_q8: workNetworkValueQ8,
    work_actual_network_value_model:
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    work_actual_network_value_q8: workNetworkValueQ8,
    work_actual_total_q8: workNetworkValueQ8,
    work_floor: floor,
    work_floor_live_network_value_q8: workNetworkValueQ8,
    work_floor_network_value_model:
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    work_floor_network_value_q8: workNetworkValueQ8,
  };
}

function isolatedTypeScriptFunction(path, name, globals = {}) {
  const context = vm.createContext({
    console: {
      error() {},
      log() {},
      warn() {},
    },
    compareExactIntegers: frontendCompareExactIntegers,
    exactIntegerBigInt: frontendExactIntegerBigInt,
    exactIntegerNumber: frontendExactIntegerNumber,
    isBondTokenDefinition: frontendIsBondTokenDefinition,
    ...globals,
  });
  const definition = topLevelFunctionSource(path, name);
  const transpiled = ts.transpileModule(definition, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new vm.Script(`${transpiled}\nthis.__checkedFunction = ${name};`, {
    filename: path.pathname,
  }).runInContext(context);
  return context.__checkedFunction;
}

async function rejection(promise, predicate, message) {
  try {
    await promise;
  } catch (error) {
    assert.ok(predicate(error), message ?? error?.message);
    return error;
  }
  assert.fail(message ?? "Expected the operation to reject");
}

const tests = [];
function check(name, run) {
  tests.push({ name, run });
}

check("listing seal confirmation follows the seal transaction status", () => {
  const sealTxid = "4".repeat(64);
  const tokenListingSealConfirmedFromTransaction = isolatedFunction(
    READER_PATH,
    "tokenListingSealConfirmedFromTransaction",
    {
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      validTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
    },
  );

  assert.equal(
    tokenListingSealConfirmedFromTransaction(
      { seal_tx_status: "pending" },
      sealTxid,
    ),
    false,
  );
  assert.equal(
    tokenListingSealConfirmedFromTransaction(
      { seal_tx_status: "confirmed" },
      sealTxid,
    ),
    true,
  );
  assert.equal(
    tokenListingSealConfirmedFromTransaction({}, sealTxid),
    false,
  );
  assert.equal(
    tokenListingSealConfirmedFromTransaction(
      { seal_tx_status: "confirmed" },
      "not-a-txid",
    ),
    false,
  );

  const readerSource = fileSource(READER_PATH);
  assert.equal(
    (readerSource.match(/seal_tx\.status AS seal_tx_status/gu) ?? []).length,
    3,
  );
  assert.equal(
    (readerSource.match(
      /sealConfirmed: tokenListingSealConfirmedFromTransaction\(row, sealTxid\)/gu,
    ) ?? []).length,
    3,
  );
});

check("full token mint reads deduplicate without sorting wide payloads", async () => {
  const canonicalTokenMintCandidateRows = isolatedFunction(
    READER_PATH,
    "canonicalTokenMintCandidateRows",
  );
  const common = {
    mint_ordinal: 0,
    mint_recipient_address: "bc1Minter",
    token_id: "A".repeat(64),
    txid: "B".repeat(64),
  };
  const rows = [
    {
      ...common,
      block_height: null,
      effective_status: "pending",
      event_id: "1",
      mint_winner_time_us: "200",
    },
    {
      ...common,
      block_height: 100,
      effective_status: "confirmed",
      event_id: "2",
      mint_winner_time_us: "100",
    },
    {
      ...common,
      block_height: null,
      effective_status: "confirmed",
      event_id: "3",
      mint_winner_time_us: "300",
    },
    {
      ...common,
      block_height: 100,
      effective_status: "confirmed",
      event_id: "4",
      mint_winner_time_us: "200",
    },
    {
      ...common,
      block_height: 100,
      effective_status: "confirmed",
      event_id: "5",
      mint_winner_time_us: "200",
    },
    {
      ...common,
      event_id: "6",
      mint_recipient_address: "bc1Other",
      mint_winner_time_us: "50",
    },
  ];
  assert.equal(
    JSON.stringify(
      canonicalTokenMintCandidateRows(rows)
        .map((row) => String(row.event_id))
        .sort(),
    ),
    JSON.stringify(["5", "6"]),
  );
  const orderedRows = [
    ["10", "300", 100, "d", 0, "bc1a", "1"],
    ["20", "200", 101, "d", 0, "bc1a", "2"],
    ["30", "200", 100, "f", 9, "bc1z", "3"],
    ["40", "200", 100, "e", 0, "bc1a", "4"],
    ["41", "200", 100, "e", 0, "bc1a", "5"],
    ["42", "200", 100, "e", 0, "bc1b", "4"],
    ["43", "200", 100, "e", 1, "bc1a", "4"],
    ["50", "200", null, "f", 0, "bc1a", "4"],
  ].map(([eventId, time, height, txidDigit, mintOrdinal, recipient, tokenDigit]) => ({
    block_height: height,
    effective_status: "confirmed",
    event_id: eventId,
    mint_ordinal: mintOrdinal,
    mint_recipient_address: recipient,
    mint_winner_time_us: time,
    token_id: tokenDigit.repeat(64),
    txid: txidDigit.repeat(64),
  }));
  assert.equal(
    JSON.stringify(
      canonicalTokenMintCandidateRows([...orderedRows].reverse()).map((row) =>
        String(row.event_id),
      ),
    ),
    JSON.stringify(["10", "20", "30", "41", "40", "42", "43", "50"]),
  );

  const queries = [];
  const proofIndexTokenMintRows = isolatedFunction(
    READER_PATH,
    "proofIndexTokenMintRows",
    {
      canonicalTokenMintCandidateRows,
      tokenMintEventQueryParts: () => ({
        candidateCte: "WITH mint_candidates AS (SELECT 1)",
        params: ["livenet"],
      }),
    },
  );
  await proofIndexTokenMintRows(
    {
      async query(sql, params) {
        queries.push({ params, sql: String(sql) });
        return { rows };
      },
    },
    "livenet",
    common.token_id,
    new URLSearchParams(),
    { limit: 100_000, offset: 0 },
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM mint_candidates/u);
  assert.match(queries[0].sql, /mint_winner_time_us/u);
  assert.doesNotMatch(queries[0].sql, /ORDER BY/u);
  assert.doesNotMatch(queries[0].sql, /FROM mint_events/u);
});

check("current token state removes listings with live close events", () => {
  const tokenListingId = isolatedFunction(READER_PATH, "tokenListingId");
  const tokenListingsWithoutClosedEvents = isolatedFunction(
    READER_PATH,
    "tokenListingsWithoutClosedEvents",
    { tokenListingId },
  );
  const firstListingId = "a".repeat(64);
  const secondListingId = "b".repeat(64);
  const thirdListingId = "c".repeat(64);
  assert.deepEqual(
    tokenListingsWithoutClosedEvents(
      [
        { listingId: firstListingId },
        { listingId: secondListingId },
        { listing: { listingId: thirdListingId } },
      ],
      [
        { listingId: secondListingId },
        { listing: { listingId: thirdListingId } },
      ],
    ).map(tokenListingId),
    [firstListingId],
  );
  assert.match(
    fileSource(READER_PATH),
    /e\.status IN \('confirmed', 'pending'\)[\s\S]*e\.kind = ANY\(ARRAY\['token-sale','token-listing-closed'\]/u,
  );
});

check("a current market lifecycle overlay owns sold and active state", () => {
  const listingId =
    "e95c6299b1fdd132b192ea040bcb8683140632b81dbde82946c5b754a8f87dbc";
  const purchaseTxid =
    "66e601cdc087d55b9d97421acd45dcdc73a441870d333ce0ba0095f9f5fbdaaf";
  const mergeTokenStateItemsByKey = (
    baseItems,
    overlayItems,
    keyForItem,
    mergeItem = (_current, incoming) => incoming,
  ) => {
    const byKey = new Map();
    for (const item of Array.isArray(baseItems) ? baseItems : []) {
      byKey.set(keyForItem(item), item);
    }
    for (const item of Array.isArray(overlayItems) ? overlayItems : []) {
      const key = keyForItem(item);
      byKey.set(key, mergeItem(byKey.get(key), item));
    }
    return [...byKey.values()];
  };
  const applyOverlay = isolatedFunction(
    API_PATH,
    "tokenStateWithIndexedMarketSummaryOverlay",
    {
      confirmedTokenSalesStats: (sales) => ({
        confirmedSales: sales.filter((sale) => sale.confirmed).length,
        confirmedSalesVolumeSats: sales.reduce(
          (total, sale) => total + Number(sale.priceSats ?? 0),
          0,
        ),
      }),
      mergeTokenListingRecord: (current, incoming) => ({
        ...(current ?? {}),
        ...(incoming ?? {}),
      }),
      mergeTokenStateItemsByKey,
      mergedSourceLabel: (...sources) => sources.filter(Boolean).join("+"),
      newerIso: (_left, right) => right,
      numericValue: (value) => Number(value) || 0,
      safeStatNumber: (payload, key) => Number(payload?.stats?.[key]) || 0,
      sortClosedTokenListings: (items) => items,
      tokenClosedListingItemKey: (item) =>
        `${item.network}:${item.listingId}:${item.closedTxid}`,
      tokenListingItemKey: (item) => `${item.network}:${item.listingId}`,
      tokenSaleItemKey: (item) => item.txid,
    },
  );
  const lifecycleOverlay = isolatedFunction(
    API_PATH,
    "tokenMarketLifecycleOverlayFromCreditListings",
    {
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
    },
  )({
    indexedAt: "2026-07-12T01:52:58.000Z",
    indexedThroughBlock: 957637,
    items: [
      {
        amount: 10000,
        buyerAddress: "buyer",
        closedAt: "2026-07-12T01:52:42.000Z",
        closedConfirmed: true,
        closedTxid: purchaseTxid,
        confirmed: true,
        listingId,
        network: "livenet",
        priceSats: 86590,
        saleTxid: purchaseTxid,
        sellerAddress: "seller",
        status: "sold",
        ticker: "WORK",
        tokenId: "work",
      },
    ],
    network: "livenet",
    source: "proof-indexer-credit-listing-lifecycle",
    stats: { complete: true, totalCount: 1 },
  });

  const result = applyOverlay(
    {
      closedListings: [],
      indexedAt: "2026-07-12T01:40:00.000Z",
      listings: [{ listingId, network: "livenet", status: "active" }],
      sales: [],
      source: "stale-summary",
      stats: {},
    },
    lifecycleOverlay,
  );
  assert.equal(result.listings.length, 0);
  assert.equal(result.closedListings[0].closedTxid, purchaseTxid);
  assert.equal(result.sales[0].txid, purchaseTxid);

  const activeListingId =
    "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa";
  const reopened = applyOverlay(
    {
      closedListings: [
        {
          closedTxid: "f".repeat(64),
          listingId: activeListingId,
          network: "livenet",
        },
      ],
      listings: [],
      sales: [
        {
          listingId: activeListingId,
          txid: "e".repeat(64),
        },
      ],
      source: "stale-summary",
      stats: {},
    },
    {
      closedListings: [],
      indexedAt: "2026-07-12T14:28:54.000Z",
      listings: [
        {
          confirmed: true,
          listingId: activeListingId,
          network: "livenet",
          sellerAddress: "seller",
        },
      ],
      sales: [],
      source: "proof-indexer-credit-listing-lifecycle",
      stats: { complete: true },
    },
  );
  assert.equal(reopened.listings[0].listingId, activeListingId);
  assert.equal(reopened.closedListings.length, 0);
  assert.equal(reopened.sales.length, 0);
});

check("marketplace fast fallback fails closed without lifecycle coverage", async () => {
  const fastMarketplaceOverlay = isolatedFunction(
    API_PATH,
    "marketplaceSummaryPayloadWithIndexedMarketOverlay",
    {
      compactTokenSummaryPayload: (payload) => payload,
      indexedTokenMarketSummaryOverlay: async () => null,
      marketplaceSummaryWithCurrentBtcUsd: (payload) => payload,
      newerIso: (_left, right) => right,
      payloadSnapshotId: () => "",
      tokenStateWithIndexedMarketSummaryOverlay: (payload) => payload,
      workFloorWithIndexedMarketSummaryOverlay: (payload) => payload,
    },
  );
  assert.equal(
    await fastMarketplaceOverlay(
      { token: { listings: [{ listingId: "stale" }] }, workFloor: {} },
      "livenet",
      { fast: true },
    ),
    null,
  );
});

check("market lifecycle remains live when event enrichment is slow", async () => {
  const listingId =
    "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa";
  const indexedTokenMarketSummaryOverlay = isolatedFunction(
    API_PATH,
    "indexedTokenMarketSummaryOverlay",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 10,
      errorSummary: (error) => String(error?.message ?? error),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      payloadWithFallbackAfterMs: (promise, fallback) =>
        Promise.race([
          promise,
          new Promise((resolve) => setImmediate(() => resolve(fallback))),
        ]),
      proofIndexCreditListingsPayload: async () => ({
        indexedAt: "2026-07-12T14:28:54.000Z",
        indexedThroughBlock: 957712,
        items: [{ listingId }],
        stats: { complete: true, totalCount: 1 },
      }),
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexTokenMarketSummaryOverlayPayload: () =>
        new Promise(() => {}),
      setImmediate,
      tokenMarketLifecycleOverlayFromCreditListings: (payload) => ({
        closedListings: [],
        indexedAt: payload.indexedAt,
        indexedThroughBlock: payload.indexedThroughBlock,
        listings: payload.items,
        sales: [],
        source: "proof-indexer-credit-listing-lifecycle",
        stats: payload.stats,
      }),
    },
  );
  const result = await indexedTokenMarketSummaryOverlay("livenet", "");
  assert.equal(result.listings[0].listingId, listingId);
  assert.equal(result.indexedThroughBlock, 957712);
});

check("market lifecycle overrides stale event closures", async () => {
  const listingId =
    "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa";
  const indexedTokenMarketSummaryOverlay = isolatedFunction(
    API_PATH,
    "indexedTokenMarketSummaryOverlay",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 10,
      errorSummary: (error) => String(error?.message ?? error),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCreditListingsPayload: async () => ({
        indexedAt: "2026-07-12T14:28:54.000Z",
        indexedThroughBlock: 957712,
        items: [{ listingId }],
        stats: { complete: true, totalCount: 1 },
      }),
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexTokenMarketSummaryOverlayPayload: async () => ({
        closedListings: [
          { closedTxid: "f".repeat(64), listingId },
        ],
        listings: [{ listingId: "e".repeat(64) }],
        stats: { complete: true },
      }),
      tokenMarketLifecycleOverlayFromCreditListings: (payload) => ({
        closedListings: [],
        indexedAt: payload.indexedAt,
        indexedThroughBlock: payload.indexedThroughBlock,
        listings: payload.items,
        sales: [],
        source: "proof-indexer-credit-listing-lifecycle",
        stats: payload.stats,
      }),
      tokenStateWithIndexedMarketSummaryOverlay: (_history, lifecycle) =>
        lifecycle,
    },
  );
  const result = await indexedTokenMarketSummaryOverlay("livenet", "");
  assert.equal(result.listings[0].listingId, listingId);
  assert.equal(result.closedListings.length, 0);
});

check("unscoped credit lifecycle reads query every token", async () => {
  const scopes = [];
  const proofIndexCreditListingsPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCreditListingsPayload",
    {
      boundedInteger: (value, fallback, min, max) =>
        Math.min(max, Math.max(min, Number(value ?? fallback))),
      dateIso: (value) => new Date(value).toISOString(),
      latestProofIndexScanMetadata: async () => ({
        generated_at: "2026-07-12T14:28:54.000Z",
        indexed_through_block: 957712,
      }),
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {},
      proofIndexPool: () => ({
        async query(sql, params) {
          scopes.push(params[1]);
          return /count\(\*\) AS total_count/u.test(String(sql))
            ? { rows: [{ total_count: 0 }] }
            : { rows: [] };
        },
      }),
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
      tokenScopeKey: (value) =>
        String(value ?? "").trim().toLowerCase() || "all",
    },
  );
  await proofIndexCreditListingsPayload("livenet", "");
  assert.deepEqual(scopes, ["", ""]);
});

check("an exact WORK transfer miss requests canonical recovery", () => {
  const txid = "a".repeat(64);
  const exactTransferHistoryNeedsCanonicalRecovery = isolatedFunction(
    API_PATH,
    "exactTransferHistoryNeedsCanonicalRecovery",
    {
      WORK_TOKEN_ID: "work",
      isValidBitcoinAddress: (address) => String(address).startsWith("bc1"),
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pruneInternalVerifierStateCache: () => {},
      normalizedTokenHistoryKind: (kind) => String(kind).toLowerCase(),
      recoveryTxidsFromSearchParams: (params) => [
        ...new Set(
          ["q", "search", "txid", "transaction", "transactionId"]
            .flatMap((key) => params.getAll(key))
            .map((value) => value.toLowerCase())
            .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
        ),
      ],
    },
  );
  const params = new URLSearchParams({ txid });
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      { items: [], network: "livenet" },
      "work",
      "transfers",
      params,
    ),
    true,
  );
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      {
        items: [
          {
            recipientAddress: "bc1recipient",
            senderAddress: "bc1sender",
            txid,
          },
        ],
        network: "livenet",
      },
      "work",
      "transfers",
      params,
    ),
    false,
  );
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      {
        canonicalInvalidTxids: [txid],
        items: [],
        network: "livenet",
      },
      "work",
      "transfers",
      params,
    ),
    false,
  );
  const missingTxid = "b".repeat(64);
  const mixedParams = new URLSearchParams();
  mixedParams.append("txid", txid);
  mixedParams.append("transactionId", missingTxid);
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      {
        canonicalInvalidTxids: [txid],
        items: [],
        network: "livenet",
      },
      "work",
      "transfers",
      mixedParams,
    ),
    false,
  );
});

check("canonical credit overlays retain explicit address scope", async () => {
  const address = "bc1wallet";
  const requestedTxid = "a".repeat(64);
  const otherTxid = "b".repeat(64);
  let filteredAddresses = null;
  let filteredItems = null;
  let mergeOptions = null;
  const tokenHistoryPageWithCanonicalCreditValueOverlay = isolatedFunction(
    API_PATH,
    "tokenHistoryPageWithCanonicalCreditValueOverlay",
    {
      BOND_TOKEN_IDS: new Set(["powb", "incb"]),
      POWB_TOKEN_ID: "powb",
      WORK_TOKEN_ID: "work",
      activeTokenListingsFromState: () => [],
      currentCanonicalWorkTransferValueSummary: async () => ({}),
      existingCanonicalLedgerPayload: async () => null,
      existingCurrentCanonicalLedgerPayload: async () => ({
        generatedAt: "2026-07-11T00:00:00.000Z",
      }),
      historyItemsMatchingAddresses: (items, addresses) => {
        filteredAddresses = addresses;
        filteredItems = items;
        return items;
      },
      historyPaginationFromSearch: () => ({
        limit: 20,
        offset: 0,
        page: 0,
        query: "",
      }),
      ledgerTokenStateForScope: () => ({
        transfers: [
          { recipientAddress: address, txid: otherTxid },
          { recipientAddress: address, txid: requestedTxid },
        ],
      }),
      mergeTokenHistoryPageWithOverlay: (page, _overlay, _pagination, options) => {
        mergeOptions = options;
        return page;
      },
      mergedSourceLabel: () => "test",
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      normalizedTokenHistoryKind: (kind) => String(kind).toLowerCase(),
      paginatedHistoryPayload: (value) => value,
      recoveryAddressHintsFromSearchParams: () => [address],
      recoveryTxidsFromSearchParams: (params) =>
        [params.get("txid")].filter(Boolean),
      tokenHistoryKindNeedsCreditNetworkValueOverlay: () => true,
      tokenHistoryPageWithCanonicalWorkTransferValues: (page) => page,
      tokenMarketLogItemsFromState: () => [],
    },
  );
  await tokenHistoryPageWithCanonicalCreditValueOverlay(
    { items: [] },
    "livenet",
    "work",
    "transfers",
    new URLSearchParams({ address }),
  );
  assert.deepEqual(filteredAddresses, [address]);
  assert.equal(mergeOptions?.addOverlayItems, false);

  await tokenHistoryPageWithCanonicalCreditValueOverlay(
    { items: [] },
    "livenet",
    "work",
    "transfers",
    new URLSearchParams({ address, txid: requestedTxid }),
  );
  assert.deepEqual(
    Array.from(filteredItems, (item) => item.txid),
    [requestedTxid],
    "an older exact tx read must filter before overlay pagination",
  );
});

check("canonical credit fee fields cannot be overwritten by stale projections", () => {
  const fields = [
    "attributedMinerFeeSats",
    "canonicalMinerFeeSats",
    "fixedEventFlowSats",
    "frozenNetworkValueSats",
    "minerFeeSats",
    "transactionMinerFeeSats",
  ];
  const mergeCreditNetworkValueRecord = isolatedFunction(
    API_PATH,
    "mergeCreditNetworkValueRecord",
    { CREDIT_NETWORK_VALUE_FIELD_NAMES: fields },
  );
  const canonical = {
    attributedMinerFeeSats: 0,
    canonicalMinerFeeCovered: true,
    canonicalMinerFeeSats: 0,
    fixedEventFlowSats: 546,
    frozenNetworkValueSats: 746,
    minerFeeSats: 0,
    minerFeeSource: "proof-indexer-normalized-input-output-totals",
    transactionMinerFeeSats: 0,
  };
  const stale = {
    attributedMinerFeeSats: 999,
    canonicalMinerFeeCovered: false,
    canonicalMinerFeeSats: 999,
    fixedEventFlowSats: 1_545,
    frozenNetworkValueSats: 1_745,
    minerFeeSats: 999,
    minerFeeSource: "legacy-payload",
    transactionMinerFeeSats: 999,
  };
  const preserved = mergeCreditNetworkValueRecord(canonical, stale);
  assert.equal(preserved.canonicalMinerFeeCovered, true);
  assert.equal(preserved.canonicalMinerFeeSats, 0);
  assert.equal(preserved.minerFeeSats, 0);
  assert.equal(preserved.attributedMinerFeeSats, 0);
  assert.equal(preserved.fixedEventFlowSats, 546);
  assert.equal(preserved.frozenNetworkValueSats, 746);
  assert.equal(
    preserved.minerFeeSource,
    "proof-indexer-normalized-input-output-totals",
  );

  const incomingCanonical = {
    ...stale,
    canonicalMinerFeeCovered: true,
    canonicalMinerFeeSats: 22,
    minerFeeSats: 22,
    minerFeeSource: "new-canonical-source",
  };
  const replaced = mergeCreditNetworkValueRecord(
    { ...canonical, canonicalMinerFeeSats: 11, minerFeeSats: 11 },
    incomingCanonical,
  );
  assert.equal(replaced.canonicalMinerFeeSats, 22);
  assert.equal(replaced.minerFeeSats, 22);
  assert.equal(replaced.minerFeeSource, "new-canonical-source");
  assert.match(
    topLevelFunctionSource(API_PATH, "mergeTokenTransferRecord"),
    /mergeCreditNetworkValueRecord\(current, incoming\)/u,
  );
  const floorMergeSource = topLevelFunctionSource(
    API_PATH,
    "tokenPayloadWithCanonicalHistoryFloor",
  );
  assert.match(
    floorMergeSource,
    /next\.mints = mergeCanonicalHistoryItems\([\s\S]*?mergeCreditNetworkValueRecord/u,
  );
  assert.match(
    floorMergeSource,
    /next\.sales = mergeCanonicalHistoryItems\([\s\S]*?mergeCreditNetworkValueRecord/u,
  );
});

check("livenet WORK snapshots require the unique-transaction fee model", async () => {
  const verifiedCanonicalMinerFeeCoverage = isolatedFunction(
    API_PATH,
    "verifiedCanonicalMinerFeeCoverage",
  );
  const workFloorPayloadHasFiniteNetworkValue = isolatedFunction(
    API_PATH,
    "workFloorPayloadHasFiniteNetworkValue",
    {
      CREDIT_MINER_FEE_ACCOUNTING_MODEL:
        "canonical-unique-tx-input-output-v1",
      finitePositiveNumber: (value) => Number(value) > 0,
      numbersAgree: (left, right) => Number(left) === Number(right),
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  const floor = {
    actualValue: {
      frozenNetworkValueSats: 900,
      liveNetworkValueSats: 1_000,
      totalSats: 1_000,
    },
    frozenNetworkValueSats: 900,
    liveNetworkValueSats: 1_000,
    network: "livenet",
    networkValueSats: 1_000,
  };
  assert.equal(workFloorPayloadHasFiniteNetworkValue(floor), false);
  assert.equal(
    workFloorPayloadHasFiniteNetworkValue({
      ...floor,
      actualValue: {
        ...floor.actualValue,
        creditMinerFeeAccountingModel:
          "canonical-unique-tx-input-output-v1",
        creditMinerFeeCoverage: {
          complete: true,
          confirmedEvents: 2,
          confirmedTransactions: 1,
          coveredConfirmedEvents: 2,
          coveredConfirmedTransactions: 1,
          missingConfirmedEvents: 0,
          missingConfirmedTransactions: 0,
          missingConfirmedTxids: [],
          source: "proof-indexer-normalized-input-output-totals",
        },
      },
    }),
    true,
  );
  const ledgerWithReplayedCreditNetworkValues = isolatedFunction(
    API_PATH,
    "ledgerWithReplayedCreditNetworkValues",
    {
      ledgerPayloadIsUsableFallback: () => true,
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  assert.equal(
    await ledgerWithReplayedCreditNetworkValues(
      {
        registryState: {},
        tokenState: {},
        workFloor: {
          actualValue: {
            creditMinerFeeAccountingModel:
              "canonical-unique-tx-input-output-v1",
          },
        },
      },
      "livenet",
    ),
    null,
    "model-only cached ledgers must not self-attest a replay",
  );
});

check("current ID reads exclude dropped registration transactions", async () => {
  const confirmedIdRecordsFromCurrentTables = isolatedFunction(
    READER_PATH,
    "confirmedIdRecordsFromCurrentTables",
    {
      confirmedIdRecordFromRow: (row) => ({
        confirmed: true,
        id: row.display_id,
        txid: row.registration_txid,
      }),
    },
  );
  const databaseRows = [
    {
      display_id: "inception",
      registration_txid: "1".repeat(64),
      status: "confirmed",
    },
    {
      display_id: "dropped-name",
      registration_txid: "2".repeat(64),
      status: "dropped",
    },
  ];
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ params, sql });
      let rows = [...databaseRows];
      if (/t\.status\s*=\s*'confirmed'/u.test(sql)) {
        rows = rows.filter((row) => row.status === "confirmed");
      }
      if (params.length > 1) {
        rows = rows.filter(
          (row) => row.display_id.toLowerCase() === String(params[1]).toLowerCase(),
        );
      }
      return { rows };
    },
  };

  const all = await confirmedIdRecordsFromCurrentTables(pool, "livenet");
  assert.deepEqual(
    Array.from(all, (record) => record.id),
    ["inception"],
  );
  const dropped = await confirmedIdRecordsFromCurrentTables(
    pool,
    "livenet",
    "dropped-name",
  );
  assert.equal(dropped.length, 0);
  assert.deepEqual(Array.from(calls[1].params), ["livenet", "dropped-name"]);
  assert.match(calls[0].sql, /e\.payload->>'blockIndex'/u);
  assert.match(calls[0].sql, /registration_event\.registration_event_id DESC/u);
  assert.match(
    calls[0].sql,
    /COALESCE\(r\.registered_height, t\.block_height\) DESC/u,
  );
});

check("Electrum registry hydration preserves canonical history heights", async () => {
  const armyTxid = "a8622941a8ac1ed6ac8a8df58ce40795fc7d97b3615d81e9dc23ca6c0cf820fa";
  const registryTxid = "664f605a032a726f248c7ea298773e04ccabd063555cf109cfd02736935bc84e";
  const fetchAddressTransactionsFromElectrum = isolatedFunction(
    API_PATH,
    "fetchAddressTransactionsFromElectrum",
    {
      ADDRESS_ELECTRUM_HISTORY_TIMEOUT_MS: 1_000,
      TX_FETCH_CONCURRENCY: 2,
      dedupeTransactions: (transactions) => transactions,
      electrumRequest: async () => [
        { height: 948_376, tx_hash: armyTxid },
        { height: 948_376, tx_hash: registryTxid },
      ],
      fetchTransactionFromElectrum: async (txid) => ({
        status: {
          block_hash: "f".repeat(64),
          confirmed: true,
        },
        txid,
      }),
      fetchTransactionWithSourceFallback: async () => null,
      mapWithConcurrency: async (items, _limit, mapper) =>
        Promise.all(items.map(mapper)),
      scriptHashForAddress: () => "scripthash",
    },
  );
  const transactions = await fetchAddressTransactionsFromElectrum(
    "bc1registry",
    "livenet",
  );
  assert.deepEqual(
    Array.from(transactions, (transaction) => transaction.status.block_height),
    [948_376, 948_376],
  );
});

check("ID records pin canonical block position and newest-first display", () => {
  const records = [
    {
      blockHeight: 948_376,
      blockIndex: 1_601,
      confirmed: true,
      id: "armyofyouth",
      txid: "a8622941a8ac1ed6ac8a8df58ce40795fc7d97b3615d81e9dc23ca6c0cf820fa",
    },
    {
      blockHeight: 948_376,
      blockIndex: 1_602,
      confirmed: true,
      id: "satoshin",
      txid: "74312caa53ee552d2ff85944d99e700fe313208378db17506b490f0e99349b0f",
    },
    {
      blockHeight: 948_376,
      blockIndex: 2_080,
      confirmed: true,
      id: "bitcoin",
      txid: "6ef73916cdc421e62df2a7df7bb4269b40db7b8616f9545f99f34a15e7a1932e",
    },
    {
      blockHeight: 948_376,
      blockIndex: 2_081,
      confirmed: true,
      id: "registry",
      txid: "664f605a032a726f248c7ea298773e04ccabd063555cf109cfd02736935bc84e",
    },
  ];
  const compareRegistryRecordDisplayOrder = isolatedFunction(
    API_PATH,
    "compareRegistryRecordDisplayOrder",
  );
  const expected = ["registry", "bitcoin", "satoshin", "armyofyouth"];
  const freshOrder = records
    .slice()
    .sort(compareRegistryRecordDisplayOrder)
    .map((record) => record.id);
  const indexedOrder = records
    .slice()
    .reverse()
    .sort(compareRegistryRecordDisplayOrder)
    .map((record) => record.id);
  assert.deepEqual(freshOrder, expected);
  assert.deepEqual(indexedOrder, expected);

  const crossBlock = [
    { blockHeight: 948_377, blockIndex: 1, confirmed: true, txid: "1" },
    { blockHeight: 948_376, blockIndex: 3_000, confirmed: true, txid: "2" },
  ].sort(compareRegistryRecordDisplayOrder);
  assert.equal(crossBlock[0].blockHeight, 948_377);
});

check("scoped WORK summaries preserve canonical holder totals and identity", async () => {
  const normalizeTokenTicker = (ticker) =>
    String(ticker ?? "").trim().toUpperCase();
  const tokenHolderMatchesDefinition = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenHolderMatchesDefinition",
    { normalizeTokenTicker },
  );
  const tokenHoldersForDefinition = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenHoldersForDefinition",
    { tokenHolderMatchesDefinition },
  );
  const tokenHolderTotalCount = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenHolderTotalCount",
  );
  const work = {
    holderCount: 311,
    ticker: "WORK",
    tokenId: "work-token-id",
  };
  const previewHolders = Array.from({ length: 40 }, (_, index) => ({
    address: `preview-${index}`,
    balance: 40 - index,
  }));
  const compactSaleReplay = Array.from({ length: 13 }, (_, index) => ({
    address: `sale-${index}`,
    balance: 13 - index,
  }));
  const resolved = tokenHoldersForDefinition(
    work,
    [work],
    previewHolders,
    compactSaleReplay,
  );
  assert.equal(resolved.length, 40);
  assert.equal(resolved[0].address, "preview-0");
  assert.equal(tokenHolderTotalCount(work, resolved), 311);

  const other = { ticker: "OTHER", tokenId: "other-token-id" };
  const ambiguous = tokenHoldersForDefinition(
    work,
    [work, other],
    previewHolders,
    compactSaleReplay,
  );
  assert.equal(ambiguous.length, 13);
  assert.equal(ambiguous[0].address, "sale-0");

  const normalizeTokenScope = (value) =>
    String(value ?? "").trim().toLowerCase();
  const tokenMatchesScope = (token, scope) =>
    normalizeTokenScope(token?.tokenId) === scope ||
    normalizeTokenScope(token?.ticker) === scope;
  const tokenPayloadWithScopedHolderIdentity = isolatedFunction(
    API_PATH,
    "tokenPayloadWithScopedHolderIdentity",
    { normalizeTokenScope, tokenMatchesScope },
  );
  const scopedPayload = tokenPayloadWithScopedHolderIdentity(
    { holders: previewHolders, tokens: [work] },
    work.tokenId,
  );
  assert.equal(scopedPayload.holders.length, 40);
  assert.ok(
    scopedPayload.holders.every(
      (holder) =>
        holder.tokenId === work.tokenId && holder.ticker === work.ticker,
    ),
  );
  const multiTokenPayload = {
    holders: previewHolders,
    tokens: [work, other],
  };
  assert.equal(
    tokenPayloadWithScopedHolderIdentity(multiTokenPayload, work.tokenId),
    multiTokenPayload,
  );

  let holderSql = "";
  const scopedHoldersFromBalances = isolatedFunction(
    READER_PATH,
    "scopedHoldersFromBalances",
  );
  const indexedHolders = await scopedHoldersFromBalances(
    {
      async query(sql) {
        holderSql = String(sql);
        return {
          rows: [
            {
              address: "bc1holder",
              confirmed_balance: "1234",
              ticker: "WORK",
              token_id: "WORK-TOKEN-ID",
            },
          ],
        };
      },
    },
    "livenet",
    work.tokenId,
  );
  assert.match(holderSql, /JOIN proof_indexer\.credit_definitions/u);
  assert.equal(indexedHolders[0].balance, 1234);
  assert.equal(indexedHolders[0].ticker, "WORK");
  assert.equal(indexedHolders[0].tokenId, "work-token-id");
});

check("WORK mint progress stays below 100 until max supply confirms", () => {
  const tokenProgressPercent = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenProgressPercent",
  );
  const tokenProgressLabel = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenProgressLabel",
    { tokenProgressPercent },
  );
  assert.equal(tokenProgressLabel(20_999_000, 21_000_000), "99.995%");
  assert.equal(tokenProgressLabel(21_000_000, 21_000_000), "100%");
});

check("token send preflight retries transient canonical reads only", async () => {
  let attempts = 0;
  const retryNotices = [];
  const isAuthoritativeWalletTokenPayload = isolatedTypeScriptFunction(
    APP_PATH,
    "isAuthoritativeWalletTokenPayload",
  );
  const fetchFreshWalletTokenPreflightState = isolatedTypeScriptFunction(
    APP_PATH,
    "fetchFreshWalletTokenPreflightState",
    {
      TOKEN_SPENDABLE_RECHECK_DELAYS_MS: [0, 1, 1],
      URLSearchParams,
      delay: async () => {},
      fetchProofApiJson: async (path, network) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("canonical gate");
        }
        assert.equal(network, "livenet");
        assert.match(path, /fresh=1/u);
        assert.match(path, /wallet=1/u);
        assert.match(path, /asset=work-token-id/u);
        return {
          authoritativeWallet: true,
          closedListings: [],
          holders: [{ balance: 1 }],
          listings: [],
          sales: [],
          source: "proof-indexer-wallet-token-overlay",
          transfers: [],
          walletScoped: true,
        };
      },
      isAuthoritativeWalletTokenPayload,
      isTransientProofApiReadError: (error) =>
        error instanceof Error && error.message === "canonical gate",
      normalizeTokenAmountRecord: (item) => item,
      normalizeTokenHolderRecord: (item) => item,
      normalizeTokenListingRecords: (items) => items,
    },
  );
  const state = await fetchFreshWalletTokenPreflightState(
    "sender",
    "work-token-id",
    (attempt, total) => {
      retryNotices.push([attempt, total]);
    },
  );
  assert.equal(attempts, 2);
  assert.equal(state.holders[0].balance, 1);
  assert.deepEqual(retryNotices, [[2, 3]]);

  const unavailablePreflight = isolatedTypeScriptFunction(
    APP_PATH,
    "fetchFreshWalletTokenPreflightState",
    {
      TOKEN_SPENDABLE_RECHECK_DELAYS_MS: [0, 1],
      URLSearchParams,
      delay: async () => {},
      fetchProofApiJson: async () => ({
        authoritativeWallet: false,
        holders: [{ balance: 99_000 }],
        source: "stale-token-cache",
        walletScoped: true,
      }),
      isAuthoritativeWalletTokenPayload,
      isTransientProofApiReadError: () => false,
      normalizeTokenAmountRecord: (item) => item,
      normalizeTokenHolderRecord: (item) => item,
      normalizeTokenListingRecords: (items) => items,
    },
  );
  await rejection(
    unavailablePreflight("sender", "work-token-id"),
    (error) =>
      /could not verify this wallet balance/u.test(String(error?.message)) &&
      /No transaction was created/u.test(String(error?.message)),
  );
});

check("fresh wallet token reads never fall back behind canonical coverage", async () => {
  let fallbackReads = 0;
  let indexedReads = 0;
  const walletScopedTokenPayload = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayload",
    {
      BOND_TOKEN_IDS: new Set(),
      WALLET_SCOPED_INDEX_WAIT_MS: 10_000,
      WORK_TOKEN_ID: "work-token-id",
      currentProofIndexTokenPayloadForRead: async (
        _network,
        _scope,
        _label,
        _timeoutMs,
      ) => {
        indexedReads += 1;
        return null;
      },
      freshDataUnavailableError: (message) => new Error(message),
      normalizeTokenScope: (value) => value,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexWalletScopedTokenPayloadForRead: async () => null,
      tokenPayloadForRead: async () => {
        fallbackReads += 1;
        return {};
      },
    },
  );
  await rejection(
    walletScopedTokenPayload(
      "livenet",
      "work-token-id",
      ["sender"],
      { requireCurrent: true },
    ),
    (error) => /still catching up/u.test(String(error?.message)),
  );
  assert.equal(fallbackReads, 0);
  assert.equal(indexedReads, 0);

  const currentWalletScopedTokenPayload = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayload",
    {
      BOND_TOKEN_IDS: new Set(),
      WALLET_SCOPED_INDEX_WAIT_MS: 10_000,
      WORK_TOKEN_ID: "work-token-id",
      currentProofIndexTokenPayloadForRead: async () => {
        throw new Error("fresh reads must not use an unbound global payload");
      },
      normalizeTokenScope: (value) => value,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexWalletScopedTokenPayloadForRead: async () => ({
        holders: [],
        tokens: [{ tokenId: "other-token-id" }],
      }),
    },
  );
  const current = await currentWalletScopedTokenPayload(
    "livenet",
    "other-token-id",
    ["sender"],
    { requireCurrent: true },
  );
  assert.equal(current.authoritativeWallet, true);
});

check("authoritative wallet projections reject truncated pending or listing sets", () => {
  const walletProjectionExceedsLimit = isolatedFunction(
    READER_PATH,
    "walletProjectionExceedsLimit",
    {
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    },
  );
  const pendingRows = Array.from({ length: 501 }, () => ({
    status: "pending",
  }));
  assert.equal(walletProjectionExceedsLimit(pendingRows, 500, "pending"), true);
  assert.equal(
    walletProjectionExceedsLimit(
      [...pendingRows.slice(0, 500), { status: "confirmed" }],
      500,
      "pending",
    ),
    false,
  );
  assert.equal(
    walletProjectionExceedsLimit(Array.from({ length: 501 }, () => ({})), 500),
    true,
  );
});

check("token spendability deducts reservations and pending sends once", () => {
  const testWorkRecordAmountAtoms = (_token, amount, amountAtoms) =>
    frontendWorkRecordAtoms(amount, amountAtoms);
  const tokenTransferSpendabilityKey = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenTransferSpendabilityKey",
    {
      tokenRecordAmountAtoms: testWorkRecordAmountAtoms,
    },
  );
  const mergeTokenTransfersForSpendability = isolatedTypeScriptFunction(
    APP_PATH,
    "mergeTokenTransfersForSpendability",
    { tokenTransferSpendabilityKey },
  );
  const tokenSpendabilityForWallet = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenSpendabilityForWallet",
    {
      mergeTokenListingsById: (current, incoming) => [...current, ...incoming],
      mergeTokenTransfersForSpendability,
      isWorkToken: frontendIsWorkToken,
      tokenHolderMatchesDefinition: (holder, token) =>
        holder.tokenId === token.tokenId,
      tokenRecordAmountAtoms: testWorkRecordAmountAtoms,
      tokenListingStateKey: (listing) => listing.listingId,
      tokenListingsWithPreservedLocalPending: (_local, indexed) => indexed,
      tokenReservedBalanceFor: (listings) =>
        listings.reduce((total, listing) => total + listing.amount, 0),
      tokenReservedBalanceAtomsFor: (listings) =>
        listings.reduce((total, listing) => {
          const amountAtoms = frontendWorkRecordAtoms(
            listing.amount,
            listing.amountAtoms,
          );
          return amountAtoms === null ? total : total + amountAtoms;
        }, 0n),
      workNumberFromAtoms: frontendWorkNumberFromAtoms,
      workRecordAtoms: frontendWorkRecordAtoms,
    },
  );
  const token = { ticker: "WORK", tokenId: "work-token-id" };
  const pendingTransfer = {
    amount: 1_000,
    confirmed: false,
    recipientAddress: "recipient",
    senderAddress: "sender",
    tokenId: token.tokenId,
    txid: "pending-send",
  };
  const secondPendingTransfer = {
    ...pendingTransfer,
    amount: 2_000,
    recipientAddress: "second-recipient",
  };
  const result = tokenSpendabilityForWallet(
    "sender",
    token,
    {
      closedListings: [],
      holders: [{ address: "sender", balance: 10_763, tokenId: token.tokenId }],
      listings: [
        {
          amount: 2_000,
          listingId: "reserved-listing",
          sellerAddress: "sender",
          tokenId: token.tokenId,
        },
      ],
      sales: [],
      transfers: [pendingTransfer, secondPendingTransfer],
    },
    [],
    [],
    [pendingTransfer, secondPendingTransfer],
    [],
  );
  assert.equal(result.confirmedBalance, 10_763);
  assert.equal(result.reservedBalance, 2_000);
  assert.equal(result.pendingOutgoing, 3_000);
  assert.equal(result.spendableBalance, 5_763);

  const identicalRecipientResult = tokenSpendabilityForWallet(
    "sender",
    token,
    {
      closedListings: [],
      holders: [{ address: "sender", balance: 10_000, tokenId: token.tokenId }],
      listings: [],
      sales: [],
      transfers: [pendingTransfer, pendingTransfer],
    },
    [],
    [],
    [pendingTransfer, pendingTransfer],
    [],
  );
  assert.equal(identicalRecipientResult.pendingOutgoing, 2_000);
  assert.equal(identicalRecipientResult.spendableBalance, 8_000);

  const mixedPendingResult = tokenSpendabilityForWallet(
    "sender",
    token,
    {
      closedListings: [],
      holders: [{ address: "sender", balance: 10_000, tokenId: token.tokenId }],
      listings: [],
      sales: [],
      transfers: [pendingTransfer, { ...pendingTransfer, recipientAddress: "sender" }],
    },
    [],
    [],
    [],
    [],
  );
  assert.equal(mixedPendingResult.pendingOutgoing, 1_000);
  assert.equal(mixedPendingResult.spendableBalance, 9_000);

  const pendingCloseResult = tokenSpendabilityForWallet(
    "sender",
    token,
    {
      closedListings: [],
      holders: [{ address: "sender", balance: 10_000, tokenId: token.tokenId }],
      listings: [],
      sales: [],
      transfers: [],
    },
    [],
    [
      {
        amount: 8_000,
        closedConfirmed: false,
        confirmed: true,
        listingId: "pending-delist",
        sellerAddress: "sender",
        tokenId: token.tokenId,
      },
    ],
    [],
    [],
  );
  assert.equal(pendingCloseResult.reservedBalance, 8_000);
  assert.equal(pendingCloseResult.spendableBalance, 2_000);
});

check("clean scoped account lanes suppress stale WORK and bond positives", () => {
  const tokenScopeMatchesToken = (
    token,
    tokenScope = "",
  ) => {
    const normalizedScope = String(tokenScope).trim();
    return (
      normalizedScope.length > 0 &&
      (token.tokenId === normalizedScope ||
        token.ticker === String(normalizedScope).trim().toUpperCase())
    );
  };
  const tokenWalletBalanceAmountUnits = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenWalletBalanceAmountUnits",
    { tokenRecordAmountAtoms: frontendTokenRecordAmountAtoms },
  );
  const compareTokenWalletBalanceAmounts = isolatedTypeScriptFunction(
    APP_PATH,
    "compareTokenWalletBalanceAmounts",
    { tokenWalletBalanceAmountUnits },
  );
  const mergeTokenWalletBalancesByToken = isolatedTypeScriptFunction(
    APP_PATH,
    "mergeTokenWalletBalancesByToken",
    {
      compareTokenWalletBalanceAmounts,
      normalizeTokenTicker: (value) => String(value).trim().toUpperCase(),
    },
  );
  const accountTokenBalanceMatchesLane = isolatedTypeScriptFunction(
    APP_PATH,
    "accountTokenBalanceMatchesLane",
    { tokenScopeMatchesToken },
  );
  const mergeAccountTokenWalletBalanceLanes = isolatedTypeScriptFunction(
    APP_PATH,
    "mergeAccountTokenWalletBalanceLanes",
    { accountTokenBalanceMatchesLane, mergeTokenWalletBalancesByToken },
  );
  const balance = (tokenId, ticker, confirmedBalance) => ({
    confirmedBalance,
    pendingIncoming: 0,
    pendingOutgoing: 0,
    token: { ticker, tokenId },
  });
  const stale = [
    balance("work-token-id", "WORK", 30),
    balance("powb-token-id", "POWB", 20),
    balance("incb-token-id", "INCB", 10),
    balance("other-token-id", "OTHER", 5),
  ];
  const merged = mergeAccountTokenWalletBalanceLanes(stale, false, [
    {
      balances: [],
      clean: true,
      ticker: "WORK",
      tokenId: "work-token-id",
    },
    {
      balances: [],
      clean: true,
      ticker: "POWB",
      tokenId: "powb-token-id",
    },
    {
      balances: [],
      clean: true,
      ticker: "INCB",
      tokenId: "incb-token-id",
    },
  ]);
  assert.equal(
    merged.map((item) => item.token.ticker).join(","),
    "OTHER",
  );
  const cleanAllWithFailedScopedLane = mergeAccountTokenWalletBalanceLanes(
    [balance("work-token-id", "WORK", 30)],
    true,
    [
      {
        balances: [balance("work-token-id", "WORK", 999)],
        clean: false,
        ticker: "WORK",
        tokenId: "work-token-id",
      },
    ],
  );
  assert.equal(cleanAllWithFailedScopedLane[0].confirmedBalance, 30);

  const accountTokenLaneForDefinition = isolatedTypeScriptFunction(
    APP_PATH,
    "accountTokenLaneForDefinition",
    {
      INCB_TOKEN_ID: "incb-token-id",
      INCB_TOKEN_TICKER: "INCB",
      POWB_TOKEN_ID: "powb-token-id",
      POWB_TOKEN_TICKER: "POWB",
      WORK_TOKEN_ID: "work-token-id",
      WORK_TOKEN_TICKER: "WORK",
      tokenScopeMatchesToken,
    },
  );
  const accountTokenLaneHasCleanAuthority = isolatedTypeScriptFunction(
    APP_PATH,
    "accountTokenLaneHasCleanAuthority",
    { accountTokenLaneForDefinition },
  );
  const statuses = {
    all: { error: "", loaded: false, loading: false },
    work: { error: "", loaded: true, loading: false },
    powb: { error: "", loaded: true, loading: false },
    incb: { error: "", loaded: true, loading: false },
  };
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[0].token, statuses),
    true,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[1].token, statuses),
    true,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[2].token, statuses),
    true,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[3].token, statuses),
    false,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[0].token, {
      ...statuses,
      work: { error: "stale", loaded: true, loading: false },
    }),
    false,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[3].token, {
      ...statuses,
      all: { error: "", loaded: true, loading: false },
    }),
    true,
  );

  const walletBalancesForConnection = isolatedTypeScriptFunction(
    APP_PATH,
    "walletBalancesForConnection",
  );
  assert.deepEqual(walletBalancesForConnection("connected", [], stale), []);
  assert.deepEqual(walletBalancesForConnection("", [], stale), stale);
});

check("insufficient credit balance records exact attempted and available amounts", () => {
  const insufficientTokenBalanceInvalidEvent = isolatedFunction(
    API_PATH,
    "insufficientTokenBalanceInvalidEvent",
  );
  const event = insufficientTokenBalanceInvalidEvent({
    actorAddress: "1PNdpSender",
    amount: 99_000,
    confirmedBalance: 10_763,
    recipientAddress: "1Pg9Recipient",
    reservedBalance: 0,
    ticker: "WORK",
    tokenId: "4".repeat(64),
  });
  assert.equal(event.reasonCode, "insufficient-spendable-balance");
  assert.equal(event.attemptedAmount, 99_000);
  assert.equal(event.availableAmount, 10_763);
  assert.equal(event.confirmedBalance, 10_763);
  assert.equal(event.spendableBalance, 10_763);
  assert.match(event.reason, /10,763 available; 99,000 attempted/u);
});

check("WORK atomic sends and sale authorizations preserve one atom", () => {
  const parseTokenPayload = isolatedFunction(API_PATH, "parseTokenPayload", {
    TOKEN_CREATE_ACTION: "create",
    TOKEN_LIST_ACTION: "list",
    TOKEN_MINT_ACTION: "mint",
    TOKEN_PROTOCOL_PREFIX: "pwt1:",
    TOKEN_SEND_ACTION: "send",
    WORK_TOKEN_MAX_SUPPLY: 21_000_000,
    isValidBitcoinAddress: () => true,
    normalizeTokenTicker: (value) => String(value).trim().toUpperCase(),
  });
  const recipient = "bc1fractionalrecipient";
  const atomicSend = parseTokenPayload(
    `pwt1:send2:${WORK_TOKEN_ID}:1:${recipient}`,
    "livenet",
  );
  assert.deepEqual(
    {
      amount: atomicSend?.amount,
      amountAtoms: atomicSend?.amountAtoms,
      amountVersion: atomicSend?.amountVersion,
      decimals: atomicSend?.decimals,
      kind: atomicSend?.kind,
      unitScale: atomicSend?.unitScale,
    },
    {
      amount: "0.00000001",
      amountAtoms: "1",
      amountVersion: "send2",
      decimals: 8,
      kind: "send",
      unitScale: "100000000",
    },
  );
  assert.equal(
    parseTokenPayload(
      `pwt1:send2:${WORK_TOKEN_ID}:01:${recipient}`,
      "livenet",
    ),
    null,
  );
  assert.equal(
    parseTokenPayload(
      `pwt1:send2:${"4".repeat(64)}:1:${recipient}`,
      "livenet",
    ),
    null,
  );
  assert.equal(
    parseTokenPayload(
      `pwt1:send:${WORK_TOKEN_ID}:21000001:${recipient}`,
      "livenet",
    ),
    null,
  );
  const unsafeBondAmount = "9007199254740993";
  const unsafeBondSend = parseTokenPayload(
    `pwt1:send:${INCB_TOKEN_ID}:${unsafeBondAmount}:${recipient}`,
    "livenet",
  );
  assert.deepEqual(
    {
      amount: unsafeBondSend?.amount,
      kind: unsafeBondSend?.kind,
      recipientAddress: unsafeBondSend?.recipientAddress,
      tokenId: unsafeBondSend?.tokenId,
    },
    {
      amount: unsafeBondAmount,
      kind: "send",
      recipientAddress: recipient,
      tokenId: INCB_TOKEN_ID,
    },
  );
  for (const invalidAmount of ["09007199254740993", "-1", "1.5"]) {
    assert.equal(
      parseTokenPayload(
        `pwt1:send:${INCB_TOKEN_ID}:${invalidAmount}:${recipient}`,
        "livenet",
      ),
      null,
    );
  }
  assert.equal(
    parseTokenPayload(
      `pwt1:send:${"4".repeat(64)}:${unsafeBondAmount}:${recipient}`,
      "livenet",
    ),
    null,
  );

  const saleConstants = {
    TOKEN_LISTING_ANCHOR_SIGHASH_TYPE: 131,
    TOKEN_LISTING_ANCHOR_TYPE: "p2wpkh-sale-ticket",
    TOKEN_LISTING_ANCHOR_VALUE_SATS: 546,
    TOKEN_LISTING_ANCHOR_VOUT: 1,
    TOKEN_SALE_AUTH_VERSION: "pwt-sale-v1",
  };
  const tokenSaleAuthorizationDraft = isolatedFunction(
    API_PATH,
    "tokenSaleAuthorizationDraft",
    {
      ...saleConstants,
      normalizeTokenTicker: (value) => String(value).trim().toUpperCase(),
    },
  );
  const parseTokenSaleAuthorizationJson = isolatedFunction(
    API_PATH,
    "parseTokenSaleAuthorizationJson",
    {
      ...saleConstants,
      WORK_TOKEN_TICKER: "WORK",
      isValidBitcoinAddress: () => true,
      normalizeTokenTicker: (value) => String(value).trim().toUpperCase(),
      tokenSaleAuthorizationDraft,
      validPublicKeyHex: () => true,
      validSignatureHex: () => true,
    },
  );
  const authorizationBase = {
    anchorScriptPubKey: "0014aa",
    anchorSigHashType: saleConstants.TOKEN_LISTING_ANCHOR_SIGHASH_TYPE,
    anchorType: saleConstants.TOKEN_LISTING_ANCHOR_TYPE,
    anchorValueSats: saleConstants.TOKEN_LISTING_ANCHOR_VALUE_SATS,
    anchorVout: saleConstants.TOKEN_LISTING_ANCHOR_VOUT,
    buyerAddress: "",
    expiresAt: "",
    network: "livenet",
    nonce: "fractional-work-listing",
    priceSats: 1_000,
    registryAddress: "bc1workregistry",
    sellerAddress: "bc1workseller",
    sellerPublicKey: "02aa",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
  };
  const atomicAuthorization = parseTokenSaleAuthorizationJson(
    JSON.stringify({
      ...authorizationBase,
      amountAtoms: "1",
      version: "pwt-sale-v2",
    }),
    "livenet",
  );
  assert.equal(atomicAuthorization.amount, undefined);
  assert.equal(atomicAuthorization.amountAtoms, "1");
  assert.equal(
    tokenSaleAuthorizationLedgerAmount(atomicAuthorization),
    1n,
  );
  assert.throws(() =>
    parseTokenSaleAuthorizationJson(
      JSON.stringify({
        ...authorizationBase,
        amountAtoms: "1",
        tokenId: "4".repeat(64),
        version: "pwt-sale-v2",
      }),
      "livenet",
    ),
  );
  const unsafeBondAuthorization = parseTokenSaleAuthorizationJson(
    JSON.stringify({
      ...authorizationBase,
      amount: unsafeBondAmount,
      ticker: "INCB",
      tokenId: INCB_TOKEN_ID,
      version: saleConstants.TOKEN_SALE_AUTH_VERSION,
    }),
    "livenet",
  );
  assert.equal(unsafeBondAuthorization.amount, unsafeBondAmount);
  assert.equal(
    tokenSaleAuthorizationLedgerAmount(unsafeBondAuthorization),
    BigInt(unsafeBondAmount),
  );
  const safeNumericBondAuthorization = parseTokenSaleAuthorizationJson(
    JSON.stringify({
      ...authorizationBase,
      amount: 1_000,
      ticker: "POWB",
      tokenId: POWB_TOKEN_ID,
      version: saleConstants.TOKEN_SALE_AUTH_VERSION,
    }),
    "livenet",
  );
  assert.equal(safeNumericBondAuthorization.amount, "1000");
  assert.throws(() =>
    parseTokenSaleAuthorizationJson(
      JSON.stringify({
        ...authorizationBase,
        amount: unsafeBondAmount,
        ticker: "GEN",
        tokenId: "4".repeat(64),
        version: saleConstants.TOKEN_SALE_AUTH_VERSION,
      }),
      "livenet",
    ),
  );
  const tokenSaleAuthorizationTermsMatch = isolatedFunction(
    API_PATH,
    "tokenSaleAuthorizationTermsMatch",
    { tokenSaleAuthorizationDraft },
  );
  assert.equal(
    tokenSaleAuthorizationTermsMatch(
      safeNumericBondAuthorization,
      { ...safeNumericBondAuthorization, amount: 1_000 },
    ),
    true,
  );
  assert.throws(() =>
    parseTokenSaleAuthorizationJson(
      JSON.stringify({
        ...authorizationBase,
        amountAtoms: "1",
        ticker: "POWB",
        version: "pwt-sale-v2",
      }),
      "livenet",
    ),
  );

  const tokenSaleAuthorizationUsesSpendableSaleTicketAnchor =
    isolatedFunction(
      READER_PATH,
      "tokenSaleAuthorizationUsesSpendableSaleTicketAnchor",
      {
        TOKEN_LISTING_ANCHOR_SIGHASH_TYPE:
          saleConstants.TOKEN_LISTING_ANCHOR_SIGHASH_TYPE,
        TOKEN_LISTING_ANCHOR_TYPE:
          saleConstants.TOKEN_LISTING_ANCHOR_TYPE,
        TOKEN_LISTING_ANCHOR_VALUE_SATS:
          saleConstants.TOKEN_LISTING_ANCHOR_VALUE_SATS,
        TOKEN_LISTING_ANCHOR_VOUT:
          saleConstants.TOKEN_LISTING_ANCHOR_VOUT,
        TOKEN_SALE_AUTH_VERSION: saleConstants.TOKEN_SALE_AUTH_VERSION,
        TOKEN_SALE_AUTH_VERSIONS: new Set([
          saleConstants.TOKEN_SALE_AUTH_VERSION,
          "pwt-sale-v2",
        ]),
        WORK_TOKEN_TICKER: "WORK",
        isWorkTokenId,
        validPublicKeyHex: () => true,
      },
    );
  assert.equal(
    tokenSaleAuthorizationUsesSpendableSaleTicketAnchor(
      atomicAuthorization,
    ),
    true,
  );
  assert.equal(
    tokenSaleAuthorizationUsesSpendableSaleTicketAnchor({
      ...atomicAuthorization,
      ticker: "POWB",
    }),
    false,
  );

  const exactWorkValueAtNetworkQ8 = isolatedFunction(
    API_PATH,
    "workAtomsValueAtNetworkQ8",
    { WORK_TOKEN_MAX_SUPPLY: 21_000_000 },
  );
  assert.equal(
    exactWorkValueAtNetworkQ8(1n, 21_000_000),
    1n,
    "one WORK atom must retain its exact Q8 value at the H-1 network snapshot",
  );
  assert.equal(
    exactWorkValueAtNetworkQ8(123_456_789n, 42_000_000),
    246_913_578n,
  );
  const exactNetworkQ8 = 900_719_925_474_099_312_345_678n;
  assert.equal(
    exactWorkValueAtNetworkQ8(
      357_446_000_000_000n,
      Number("9007199254740993.12345678"),
      exactNetworkQ8.toString(),
    ),
    (357_446_000_000_000n * exactNetworkQ8) /
      (21_000_000n * WORK_UNIT_SCALE),
    "the exact Q8 oracle must override its lossy Number compatibility field",
  );
});

check("wallet holder overlays preserve WORK and POWB for one address", () => {
  const mergeWalletHolders = isolatedFunction(
    API_PATH,
    "mergeWalletHolders",
  );
  const address = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
  const holders = mergeWalletHolders([], [
    {
      address,
      balance: 3_639_060,
      ticker: "WORK",
      tokenId: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    },
    {
      address,
      balance: 225_001,
      ticker: "POWB",
      tokenId: POWB_TOKEN_ID,
    },
  ]);
  assert.equal(holders.length, 2);
  assert.deepEqual(
    Array.from(holders, (holder) => [holder.ticker, holder.balance]),
    [
      ["WORK", 3_639_060],
      ["POWB", "225001"],
    ],
  );
  const zeroBalanceHolder = mergeWalletHolders([], [
    {
      address,
      balance: 0,
      ticker: "WORK",
      tokenId: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    },
  ]);
  assert.equal(zeroBalanceHolder.length, 1);
  assert.equal(zeroBalanceHolder[0].balance, 0);

  for (const functionName of [
    "walletScopedTokenSummaryPayload",
    "walletScopedTokenPayload",
  ]) {
    const source = topLevelFunctionSource(API_PATH, functionName);
    assert.doesNotMatch(source, /scope !== POWB_TOKEN_ID/u);
    assert.match(source, /tokenPayloadWithIndexedWalletOverlay/u);
  }

  const appSource = fileSource(APP_PATH);
  const walletBalanceSource = topLevelFunctionSource(
    APP_PATH,
    "tokenWalletBalancesFor",
  );
  assert.match(walletBalanceSource, /hasConfirmedReplayBase/u);
  assert.match(walletBalanceSource, /canReplayConfirmedBalance/u);
  const tokenWalletBalanceAmountUnits = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenWalletBalanceAmountUnits",
    { tokenRecordAmountAtoms: frontendTokenRecordAmountAtoms },
  );
  const tokenWalletBalanceHasAmount = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenWalletBalanceHasAmount",
    { tokenWalletBalanceAmountUnits },
  );
  const compareTokenWalletBalanceAmounts = isolatedTypeScriptFunction(
    APP_PATH,
    "compareTokenWalletBalanceAmounts",
    { tokenWalletBalanceAmountUnits },
  );
  const tokenWalletBalancesFor = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenWalletBalancesFor",
    {
      isWorkToken: frontendIsWorkToken,
      normalizeTokenTicker: (ticker) => String(ticker ?? "").toUpperCase(),
      compareTokenWalletBalanceAmounts,
      tokenRecordAmountAtoms: frontendTokenRecordAmountAtoms,
      tokenHolderMatchesDefinition: isolatedTypeScriptFunction(
        APP_PATH,
        "tokenHolderMatchesDefinition",
        {
          normalizeTokenTicker: (ticker) =>
            String(ticker ?? "").toUpperCase(),
        },
      ),
      tokenWalletBalanceHasAmount,
      workNumberFromAtoms: frontendWorkNumberFromAtoms,
      workRecordAtoms: frontendWorkRecordAtoms,
    },
  );
  const tokens = [
    {
      ticker: "WORK",
      tokenId: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    },
    {
      ticker: "POWB",
      tokenId: "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562",
    },
  ];
  const walletBalances = tokenWalletBalancesFor(
    address,
    tokens,
    [],
    [],
    [
      {
        amount: 30_060,
        buyerAddress: address,
        confirmed: true,
        tokenId: tokens[0].tokenId,
      },
    ],
    holders,
  );
  assert.deepEqual(
    Array.from(walletBalances, (balance) => [
      balance.token.ticker,
      balance.confirmedBalance,
    ]),
    [
      ["WORK", 3_639_060],
      ["POWB", "225001"],
    ],
  );
  assert.equal(
    tokenWalletBalancesFor(
      address,
      [tokens[0]],
      [],
      [],
      [
        {
          amount: 30_060,
          buyerAddress: address,
          confirmed: true,
          tokenId: tokens[0].tokenId,
        },
      ],
      [],
    ).length,
    0,
  );
  assert.match(
    appSource,
    /mergeAccountTokenWalletBalanceLanes\(\s*accountTokenWalletBalances/u,
  );
  assert.match(
    appSource,
    /mergeAccountTokenWalletBalanceLanes\([\s\S]*accountWorkWalletBalances[\s\S]*accountPowbWalletBalances/u,
  );
  assert.match(appSource, /accountUtxoAvailability\(accountUtxos, reservedListingOutpoints\)/u);
  assert.match(appSource, /activeListingAnchorOutpointsForAddress\(idListings/u);
  assert.match(appSource, /activeTokenListingAnchorOutpointsForAddress/u);

  const accountUtxoAvailability = isolatedTypeScriptFunction(
    APP_PATH,
    "accountUtxoAvailability",
    { DUST_SATS: 546 },
  );
  const values = [100_000, 10_000, 5_000, 3_000, 1_500, 1_000, 641, 546, 546];
  const utxos = values.map((value, index) => ({
    status: { confirmed: true },
    txid: String(index + 1).padStart(64, "0"),
    value,
    vout: 0,
  }));
  const availability = accountUtxoAvailability(
    utxos,
    utxos.slice(-2).map(({ txid, vout }) => ({ txid, vout })),
  );
  assert.equal(availability.confirmedBalanceSats, 122_233);
  assert.equal(availability.confirmedUtxos.length, 9);
  assert.equal(availability.reservedListingUtxos.length, 2);
  assert.equal(availability.spendableSats, 121_141);
  assert.equal(availability.spendableUtxos.length, 7);
});

check("wallet token scope preserves holder definitions and indexed invalids", async () => {
  const address = "1SenderAddress";
  const blockHash = "7".repeat(64);
  const tokenId = "4".repeat(64);
  const txid = "6".repeat(64);
  const valueSearchText = isolatedFunction(API_PATH, "valueSearchText");
  const historyItemsMatchingAddresses = isolatedFunction(
    API_PATH,
    "historyItemsMatchingAddresses",
    { valueSearchText },
  );
  const tokenPayloadScopedToAddresses = isolatedFunction(
    API_PATH,
    "tokenPayloadScopedToAddresses",
    {
      historyItemsMatchingAddresses,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const scoped = tokenPayloadScopedToAddresses(
    {
      closedListings: [],
      holders: [{ address, balance: 3_263, ticker: "WORK", tokenId }],
      invalidEvents: [],
      listings: [],
      mints: [],
      sales: [],
      stats: {},
      tokens: [{ ticker: "WORK", tokenId }],
      transfers: [],
    },
    [address],
  );
  assert.equal(scoped.tokens.length, 1);
  assert.equal(scoped.tokens[0].tokenId, tokenId);

  const mergeTokenStateItemsByKey = (
    baseItems,
    overlayItems,
    keyForItem,
    mergeItem = (_current, incoming) => incoming,
  ) => {
    const byKey = new Map();
    for (const item of Array.isArray(baseItems) ? baseItems : []) {
      byKey.set(keyForItem(item), item);
    }
    for (const item of Array.isArray(overlayItems) ? overlayItems : []) {
      const key = keyForItem(item);
      byKey.set(key, mergeItem(byKey.get(key), item));
    }
    return [...byKey.values()];
  };
  const tokenPayloadWithIndexedWalletOverlay = isolatedFunction(
    API_PATH,
    "tokenPayloadWithIndexedWalletOverlay",
    {
      errorSummary: () => "",
      mergeTokenListingRecord: (_current, incoming) => incoming,
      mergeTokenStateItemsByKey,
      mergeTokenTransferRecord: (_current, incoming) => incoming,
      mergeWalletHolders: (base, overlay) => [...base, ...overlay],
      mergedSourceLabel: (base, overlay) => `${base}+${overlay}`,
      newerIso: (left, right) => right ?? left,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      proofIndexReadFeatureEnabled: () => true,
      proofIndexWalletTokenOverlayPayload: async () => ({
        checkpointComplete: true,
        closedListings: [],
        holders: [],
        indexedAt: "2026-07-13T00:00:00.000Z",
        indexedThroughBlock: 957_935,
        indexedThroughBlockHash: blockHash,
        invalidEvents: [
          {
            confirmed: true,
            createdAt: "2026-07-06T07:53:19.000Z",
            reasonCode: "insufficient-spendable-balance",
            tokenId,
            txid,
            valid: false,
          },
        ],
        listings: [],
        sales: [],
        snapshotId: "wallet-overlay-checkpoint",
        source: "proof-indexer-wallet-token-overlay",
        sourceHashes: { blockScan: blockHash },
        transfers: [],
      }),
      tokenStateWithPreservedListingRecords: (state) => state,
      tokenTransferHistoryItemKey: isolatedFunction(
        API_PATH,
        "tokenTransferHistoryItemKey",
        {
          numericValue: (value) => {
            const number = Number(value);
            return Number.isFinite(number) ? number : 0;
          },
        },
      ),
      walletTokenOverlayMatchesPayloadCheckpoint: () => true,
      walletTokenPayloadWithCanonicalDefinitions: (state) => state,
    },
  );
  const merged = await tokenPayloadWithIndexedWalletOverlay(
    {
      closedListings: [],
      holders: [],
      indexedAt: "2026-07-12T00:00:00.000Z",
      invalidEvents: [],
      listings: [],
      sales: [],
      source: "canonical",
      stats: {},
      transfers: [],
    },
    "livenet",
    tokenId,
    [address],
    [{ ticker: "WORK", tokenId }],
  );
  assert.equal(merged.invalidEvents.length, 1);
  assert.equal(merged.invalidEvents[0].txid, txid);
  assert.equal(merged.stats.invalidEvents, 1);
  assert.equal(merged.tokens.length, 1);
  assert.equal(merged.tokens[0].tokenId, tokenId);
  assert.equal(merged.indexedThroughBlock, 957_935);
  assert.equal(merged.indexedThroughBlockHash, blockHash);
  assert.equal(merged.snapshotId, "wallet-overlay-checkpoint");
});

check("wallet index overlay binds every WORK and bond holder to a canonical definition", async () => {
  const address = "1WalletDefinitionInvariant";
  const workTokenId =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const powbTokenId =
    "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
  const incbTokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const blockHash = "7".repeat(64);
  const objectRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rowNumber = (row, key) => Number(row?.[key] ?? 0);
  const dateIso = (value) => new Date(value).toISOString();
  const tokenDefinitionFromRow = isolatedFunction(
    READER_PATH,
    "tokenDefinitionFromRow",
    { dateIso, objectRecord, rowNumber },
  );
  const proofIndexTokenDefinitionsByIds = isolatedFunction(
    READER_PATH,
    "proofIndexTokenDefinitionsByIds",
    { tokenDefinitionFromRow },
  );
  const tokenStateScopeSql = isolatedFunction(
    READER_PATH,
    "tokenStateScopeSql",
  );
  const proofIndexTokenDefinitionsFromTables = isolatedFunction(
    READER_PATH,
    "proofIndexTokenDefinitionsFromTables",
    { tokenDefinitionFromRow, tokenStateScopeSql },
  );
  const proofIndexWalletTokenDefinitions = isolatedFunction(
    READER_PATH,
    "proofIndexWalletTokenDefinitions",
    {
      proofIndexTokenDefinitionsByIds,
      proofIndexTokenDefinitionsFromTables,
    },
  );
  const proofIndexWalletCheckpointMetadata = isolatedFunction(
    READER_PATH,
    "proofIndexWalletCheckpointMetadata",
    {
      dateIso,
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      objectRecord,
      rowNumber,
    },
  );
  const definitions = [
    {
      confirmed: true,
      create_txid: workTokenId,
      created_height: 896_321,
      creator_address: "work-creator",
      max_supply: "21000000",
      metadata: { createdAt: "2026-05-15T02:57:28.000Z" },
      mint_amount: "1000",
      mint_price_sats: "1000",
      registry_address: "work-registry",
      ticker: "WORK",
      token_id: workTokenId,
    },
    {
      confirmed: true,
      create_txid: powbTokenId,
      created_height: 903_001,
      creator_address: "infinity-registry",
      max_supply: String(Number.MAX_SAFE_INTEGER),
      metadata: {
        createdAt: "2026-06-23T00:00:00.000Z",
        uncapped: true,
      },
      mint_amount: "1",
      mint_price_sats: "1",
      registry_address: "infinity-registry",
      ticker: "POWB",
      token_id: powbTokenId,
    },
    {
      confirmed: true,
      create_txid: incbTokenId,
      created_height: 956_001,
      creator_address: "inception-registry",
      max_supply: String(Number.MAX_SAFE_INTEGER),
      metadata: {
        createdAt: "2026-07-10T00:00:00.000Z",
        uncapped: true,
      },
      mint_amount: "1",
      mint_price_sats: "1",
      registry_address: "inception-registry",
      ticker: "INCB",
      token_id: incbTokenId,
    },
  ];
  let definitionQuery = null;
  let checkpointQueries = 0;
  const pool = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_balances cb")) {
        return {
          rows: definitions.map((definition, index) => ({
            address,
            confirmed_balance: String([3_654_060, 225_001, 1_000][index]),
            pending_delta: "0",
            registry_address: definition.registry_address,
            ticker: definition.ticker,
            token_id: definition.token_id,
            updated_at: "2026-07-13T21:00:00.000Z",
          })),
        };
      }
      if (text.includes("wallet_definition_invalid_marker")) {
        return { rows: [] };
      }
      if (text.includes("e.kind IN")) {
        return { rows: [] };
      }
      if (text.includes("FROM proof_indexer.credit_listings cl")) {
        return { rows: [] };
      }
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        if (text.includes("token_id = ANY")) {
          definitionQuery = { params, text };
          return { rows: definitions };
        }
        return {
          rows: definitions.filter(
            (definition) =>
              !params[1] ||
              definition.token_id === params[1] ||
              definition.ticker.toLowerCase() === String(params[1]).toLowerCase(),
          ),
        };
      }
      if (text.includes("FROM proof_indexer.ledger_snapshots")) {
        checkpointQueries += 1;
        return {
          rows: [{
            consistency_complete: false,
            generated_at: "2026-07-13T21:01:00.000Z",
            indexed_through_block: 957_926,
            indexed_through_block_hash: blockHash,
            metrics_complete: false,
            payload_complete: true,
            snapshot_id: "wallet-checkpoint",
            source_hashes: { blockScan: blockHash },
          }],
        };
      }
      assert.fail(`Unexpected wallet overlay query: ${text}`);
    },
  };
  const proofIndexWalletTokenOverlayPayload = isolatedFunction(
    READER_PATH,
    "proofIndexWalletTokenOverlayPayload",
    {
      activeTokenListingHistoryItem: () => false,
      assertCanonicalIncbDefinition: () => {},
      canonicalEventPayload: (payload) => payload ?? {},
      compareTokenItemsByTime: () => 0,
      dateIso,
      normalizeEventPayload: (payload) => payload,
      objectRecord,
      proofIndexPool: () => pool,
      proofIndexWalletTokenDefinitions,
      proofIndexWalletCheckpointMetadata,
      rowNumber,
      tokenClosedListingFromEventPayload: () => ({}),
      tokenInvalidEventFromRow: (row) => row,
      tokenInvalidEventQueryParts: () => ({
        fromSql: "FROM proof_indexer.events e WHERE e.network = $1",
        params: ["livenet"],
      }),
      tokenInvalidEventSelectSql: () =>
        "'wallet_definition_invalid_marker' AS wallet_definition_invalid_marker",
      tokenListingEffectiveCloseTxid: () => "",
      tokenListingEffectiveSaleTicketTxid: () => "",
      tokenListingFromEventPayload: () => ({}),
      tokenSaleFromEventPayload: () => ({}),
      tokenScopeKey: (value) => String(value ?? "").trim().toLowerCase(),
      tokenTransferFromEventPayload: () => ({}),
      validTxid: () => false,
      walletProjectionExceedsLimit: () => false,
    },
  );

  const overlay = await proofIndexWalletTokenOverlayPayload(
    "livenet",
    "all",
    [address],
  );
  const definedById = new Map(
    overlay.tokens.map((token) => [token.tokenId, token]),
  );
  assert.equal(overlay.holders.length, 3);
  assert.equal(overlay.tokens.length, 3);
  for (const holder of overlay.holders) {
    assert.ok(
      definedById.has(holder.tokenId),
      `${holder.ticker} holder is missing its canonical definition`,
    );
    assert.equal(definedById.get(holder.tokenId).ticker, holder.ticker);
  }
  assert.equal(definedById.get(workTokenId).maxSupply, "21000000");
  assert.equal(
    definedById.get(workTokenId).maxSupplyAtoms,
    "2100000000000000",
  );
  assert.equal(definedById.get(powbTokenId).uncapped, true);
  assert.equal(definedById.get(incbTokenId).uncapped, true);
  assert.match(definitionQuery.text, /token_id = ANY\(\$2::text\[\]\)/u);
  assert.deepEqual(
    [...definitionQuery.params[1]].sort(),
    [workTokenId, powbTokenId, incbTokenId].sort(),
  );
  assert.equal(overlay.checkpointComplete, true);
  assert.equal(overlay.indexedThroughBlock, 957_926);
  assert.equal(overlay.indexedThroughBlockHash, blockHash);
  assert.equal(checkpointQueries, 2);
  const zeroBalanceScopedDefinitions = await proofIndexWalletTokenDefinitions(
    pool,
    "livenet",
    incbTokenId,
    [],
  );
  assert.equal(
    JSON.stringify(
      zeroBalanceScopedDefinitions.map((token) => [token.tokenId, token.ticker]),
    ),
    JSON.stringify([[incbTokenId, "INCB"]]),
  );
  assert.equal(overlay.network, "livenet");
  assert.equal(overlay.snapshotId, "wallet-checkpoint");
  assert.equal(overlay.sourceHashes.blockScan, blockHash);
  assert.equal(overlay.tokenScope, "all");
});

check("wallet scoped token payload deduplicates lifecycle rows before reserving balances", () => {
  const mergeTokenStateItemsByKey = (baseItems, overlayItems, keyForItem) => {
    const byKey = new Map();
    for (const item of [...baseItems, ...overlayItems]) {
      const key = keyForItem(item);
      if (key) {
        byKey.set(key, item);
      }
    }
    return [...byKey.values()];
  };
  const walletScopedTokenPayloadFromOverlay = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayloadFromOverlay",
    {
      mergeTokenStateItemsByKey,
      mergedSourceLabel: (...values) => values.filter(Boolean).join("+"),
      normalizeTokenScope: (value) => String(value ?? "").trim().toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      tokenClosedListingItemKey: (item) =>
        `${item.network}:${item.listingId}:${item.closedTxid}`,
      tokenListingItemKey: (item) => `${item.network}:${item.listingId}`,
      tokenSaleItemKey: (item) => item.txid,
      walletTokenPayloadWithCanonicalDefinitions: (payload) => payload,
    },
  );
  const payload = walletScopedTokenPayloadFromOverlay(
    {
      closedListings: [
        {
          closedTxid: "close-1",
          confirmed: true,
          listingId: "listing-1",
          network: "livenet",
        },
        {
          closedTxid: "close-1",
          confirmed: true,
          listingId: "listing-1",
          network: "livenet",
        },
      ],
      holders: [],
      invalidEvents: [],
      listings: [
        {
          amount: 5_000,
          confirmed: true,
          listingId: "listing-2",
          network: "livenet",
          status: "event",
        },
        {
          amount: 5_000,
          confirmed: true,
          listingId: "listing-2",
          network: "livenet",
          status: "active",
        },
      ],
      sales: [
        { confirmed: true, network: "livenet", txid: "sale-1" },
        { confirmed: true, network: "livenet", txid: "sale-1" },
      ],
      source: "proof-indexer-wallet-token-overlay",
      tokens: [],
      transfers: [],
    },
    "livenet",
    "all",
  );

  assert.equal(payload.listings.length, 1);
  assert.equal(payload.listings[0].amount, 5_000);
  assert.equal(payload.listings[0].status, "active");
  assert.equal(payload.closedListings.length, 1);
  assert.equal(payload.sales.length, 1);
  assert.equal(payload.stats.confirmedListings, 1);
  assert.equal(payload.stats.confirmedSales, 1);
});

check("wallet overlays cannot cross canonical checkpoints", () => {
  const walletTokenOverlayMatchesPayloadCheckpoint = isolatedFunction(
    API_PATH,
    "walletTokenOverlayMatchesPayloadCheckpoint",
    {
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock),
      walletTokenOverlayHasExactCheckpoint: () => true,
    },
  );
  const blockHash = "8".repeat(64);
  const overlay = {
    indexedThroughBlock: 957_935,
    indexedThroughBlockHash: blockHash,
  };
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlock: 957_935, indexedThroughBlockHash: blockHash },
      overlay,
    ),
    true,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlock: 957_934, indexedThroughBlockHash: blockHash },
      overlay,
    ),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      {
        indexedThroughBlock: 957_935,
        indexedThroughBlockHash: "9".repeat(64),
      },
      overlay,
    ),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlockHash: blockHash },
      overlay,
    ),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlock: 957_935 },
      overlay,
    ),
    false,
  );
});

check("fresh wallet overlays must match the exact canonical tip", () => {
  const walletTokenOverlayMatchesCanonicalGate = isolatedFunction(
    API_PATH,
    "walletTokenOverlayMatchesCanonicalGate",
    { walletTokenOverlayHasExactCheckpoint: () => true },
  );
  const blockHash = "8".repeat(64);
  const overlay = {
    indexedThroughBlock: 957_935,
    indexedThroughBlockHash: blockHash,
  };
  const exactGate = {
    canonicalHash: blockHash,
    indexedThroughBlock: 957_935,
    ready: true,
    storedHash: blockHash,
    tipHeight: 957_935,
  };
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, exactGate),
    true,
  );
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, {
      ...exactGate,
      ready: false,
    }),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, {
      ...exactGate,
      canonicalHash: "9".repeat(64),
    }),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, {
      ...exactGate,
      tipHeight: 957_936,
    }),
    false,
  );
});

check("confirmed invalid credit events remain visible without becoming valid", async () => {
  const tokenId = "4".repeat(64);
  const txid = "6".repeat(64);
  const blockHash = "7".repeat(64);
  const senderAddress = "bc1psender";
  const recipientAddress = "18xrecipient";
  const registryAddress = "bc1pregistry";
  const rowNumber = (row, key) => Number(row?.[key] ?? 0);
  const canonicalRawTransactionMinerFeeSats = isolatedFunction(
    READER_PATH,
    "canonicalRawTransactionMinerFeeSats",
    {
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : {},
    },
  );
  const tokenInvalidAuditCosts = isolatedFunction(
    READER_PATH,
    "tokenInvalidAuditCosts",
    { canonicalRawTransactionMinerFeeSats, rowNumber },
  );
  const tokenInvalidEventFromRow = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventFromRow",
    {
      canonicalEventPayload: (payload) => payload ?? {},
      dateIso: (value) => new Date(value).toISOString(),
      normalizeEventPayload: (payload) => payload,
      rowNumber,
      tokenInvalidAuditCosts,
    },
  );
  const row = {
    block_hash: blockHash,
    effective_status: "confirmed",
    kind: "token-event-invalid",
    network: "livenet",
    participants: [
      { address: senderAddress, powid: "sender-id", role: "actor" },
      { address: recipientAddress, powid: "", role: "counterparty" },
      { address: registryAddress, powid: "", role: "registry" },
    ],
    payload: {
      actor: senderAddress,
      amount: 12_345,
      counterparty: recipientAddress,
      kind: "token-event-invalid",
      reason: "no-valid-token-event",
      recipients: [
        { address: registryAddress, amountSats: "546" },
        { address: "bc1pchange", amountSats: "646876" },
      ],
      tokenId,
      txid,
    },
    protocol: "pwt1",
    registry_address: registryAddress,
    ticker: "WORK",
    token_id: tokenId,
    transaction_block_height: 950_123,
    transaction_block_time: "2026-05-20T12:00:00.000Z",
    transaction_fee_sats: null,
    transaction_raw_tx: {
      canonicalBlockScan: { network: "livenet" },
      vin: [{ prevout: { valueSats: 648_152 } }],
      vout: [{ valueSats: 546 }, { valueSats: 646_876 }],
    },
    txid,
    validation_errors: ["no-valid-token-event"],
  };
  const mapped = tokenInvalidEventFromRow(row);
  assert.equal(mapped.valid, false);
  assert.equal(mapped.confirmed, true);
  assert.equal(mapped.kind, "token-event-invalid");
  assert.equal(mapped.reason, "no-valid-token-event");
  assert.equal(mapped.amount, 12_345);
  assert.equal(mapped.auditMinerFeeSats, 730);
  assert.equal(mapped.auditRegistryPaymentSats, 546);
  assert.equal(mapped.auditTotalCostSats, 1_276);
  assert.equal(mapped.amountSats, 0);
  assert.equal(mapped.minerFeeSats, 0);
  assert.equal(mapped.registryMutationFeeSats, 0);
  assert.equal(mapped.blockHeight, 950_123);
  assert.equal(mapped.blockHash, blockHash);
  assert.equal(mapped.senderAddress, senderAddress);
  assert.equal(mapped.recipientAddress, recipientAddress);
  assert.deepEqual(Array.from(mapped.participants), [
    senderAddress,
    recipientAddress,
    registryAddress,
  ]);
  assert.equal(mapped.participantDetails[0].powid, "sender-id");

  const tokenVerifierItemsFromState = isolatedFunction(
    API_PATH,
    "tokenVerifierItemsFromState",
  );
  const verifierItems = tokenVerifierItemsFromState(
    {
      canonicalCoverage: true,
      invalidEvents: [
        {
          ...mapped,
          amount: 99_000,
          attemptedAmount: 99_000,
          availableAmount: 10_763,
          blockHeight: 956_893,
          reason:
            "Insufficient spendable WORK balance: 10,763 available; 99,000 attempted.",
          reasonCode: "insufficient-spendable-balance",
        },
      ],
    },
    txid,
  );
  assert.equal(verifierItems.length, 1);
  assert.equal(verifierItems[0].kind, "token-event-invalid");
  assert.equal(verifierItems[0].valid, false);
  assert.equal(verifierItems[0].blockHeight, 956_893);
  assert.equal(verifierItems[0].attemptedAmount, 99_000);
  assert.equal(verifierItems[0].availableAmount, 10_763);
  assert.equal(
    verifierItems[0].reasonCode,
    "insufficient-spendable-balance",
  );

  const [canonicalBondMint] = tokenVerifierItemsFromState(
    {
      mints: [
        {
          confirmed: true,
          protocol: null,
          sourceBondTxid: txid,
          txid,
          validationMode: "canonical-incb-bond-projection",
        },
      ],
    },
    txid,
  );
  assert.equal(canonicalBondMint.kind, "token-mint");
  assert.equal(canonicalBondMint.protocol, "pwt1");
  assert.equal(canonicalBondMint.valid, true);
  const [wrongProtocolBondMint] = tokenVerifierItemsFromState(
    {
      mints: [
        {
          confirmed: true,
          protocol: "pwm1",
          sourceBondTxid: txid,
          txid,
          validationMode: "canonical-incb-bond-projection",
        },
      ],
    },
    txid,
  );
  assert.equal(wrongProtocolBondMint.protocol, "pwm1");
  const [unboundBondMint] = tokenVerifierItemsFromState(
    {
      mints: [
        {
          confirmed: true,
          protocol: null,
          sourceBondTxid: "f".repeat(64),
          txid,
          validationMode: "canonical-incb-bond-projection",
        },
      ],
    },
    txid,
  );
  assert.equal(unboundBondMint.protocol, null);

  const eventRowPayload = isolatedFunction(READER_PATH, "eventRowPayload", {
    canonicalEventPayload: (payload) => payload ?? {},
    canonicalEventIdentityDetails: isolatedFunction(
      READER_PATH,
      "canonicalEventIdentityDetails",
    ),
    dateIso: (value) => new Date(value).toISOString(),
    eventPayloadParticipants: () => [],
    normalizeEventPayload: (payload) => payload,
    normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    normalizedText: (value) => String(value ?? "").trim(),
    plausibleBitcoinEventTime: (...values) =>
      values.find((value) => Number.isFinite(Date.parse(value))),
    rowNumber,
    tokenInvalidAuditCosts,
  });
  const auditEvent = eventRowPayload(
    {
      ...row,
      block_height: 950_123,
      block_time: "2026-05-20T12:00:00.000Z",
      created_at: "2026-05-20T12:00:00.000Z",
      event_time: "2026-05-20T12:00:00.000Z",
      status: "confirmed",
    },
    "livenet",
  );
  assert.equal(auditEvent.auditMinerFeeSats, 730);
  assert.equal(auditEvent.auditRegistryPaymentSats, 546);
  assert.equal(auditEvent.auditTotalCostSats, 1_276);
  for (const field of [
    "amountSats",
    "frozenNetworkValueSats",
    "liveNetworkValueSats",
    "marketplaceMutationFeeSats",
    "minerFeeSats",
    "proofPaymentSats",
    "registryMutationFeeSats",
    "salePaymentSats",
  ]) {
    assert.equal(auditEvent[field], 0, `${field} must stay out of accounting`);
  }

  let query;
  const normalizedTxid = isolatedFunction(READER_PATH, "normalizedTxid");
  const tokenHistoryFilterNeedles = isolatedFunction(
    READER_PATH,
    "tokenHistoryFilterNeedles",
  );
  const tokenScopeKey = isolatedFunction(READER_PATH, "tokenScopeKey");
  const tokenInvalidEventQueryParts = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventQueryParts",
    { normalizedTxid, tokenHistoryFilterNeedles, tokenScopeKey },
  );
  const tokenInvalidEventSelectSql = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventSelectSql",
  );
  const proofIndexTokenInvalidEventsFromTables = isolatedFunction(
    READER_PATH,
    "proofIndexTokenInvalidEventsFromTables",
    {
      TOKEN_STATE_EVENT_READ_LIMIT: 100_000,
      compareTokenItemsByTime: () => 0,
      tokenInvalidEventFromRow,
      tokenInvalidEventQueryParts,
      tokenInvalidEventSelectSql,
    },
  );
  const items = await proofIndexTokenInvalidEventsFromTables(
    {
      async query(sql, params) {
        query = { params: Array.from(params), sql: String(sql) };
        return { rows: [row] };
      },
    },
    "livenet",
    "work",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].txid, txid);
  assert.deepEqual(query.params, ["livenet", "work"]);
  assert.match(query.sql, /e\.protocol = 'pwt1'/u);
  assert.match(query.sql, /e\.valid = false OR e\.kind = 'token-event-invalid'/u);
  assert.match(query.sql, /t\.status = 'confirmed'/u);
  assert.match(query.sql, /t\.raw_tx AS transaction_raw_tx/u);
  assert.match(query.sql, /FROM proof_indexer\.event_participants/u);

  const normalizedSnapshotId = isolatedFunction(
    READER_PATH,
    "normalizedSnapshotId",
  );
  const historyCursor = isolatedFunction(READER_PATH, "historyCursor", {
    normalizedSnapshotId,
  });
  const historyQueries = [];
  const currentTokenInvalidEventHistoryPage = isolatedFunction(
    READER_PATH,
    "currentTokenInvalidEventHistoryPage",
    {
      dateIso: (value) => new Date(value).toISOString(),
      historyCursor,
      latestProofIndexScanMetadata: async () => ({
        generated_at: "2026-07-11T12:00:00.000Z",
        indexed_through_block: 957_598,
      }),
      newestDateIso: (values) =>
        values.filter(Boolean).sort().at(-1) ?? "2026-07-11T12:00:00.000Z",
      rowNumber,
      tokenInvalidEventFromRow,
      tokenInvalidEventQueryParts,
      tokenInvalidEventSelectSql,
    },
  );
  const historyPage = await currentTokenInvalidEventHistoryPage(
    {
      async query(sql, params) {
        historyQueries.push({ params: Array.from(params), sql: String(sql) });
        return historyQueries.length === 1
          ? {
              rows: [
                {
                  indexed_at: "2026-07-03T12:00:00.000Z",
                  indexed_through_block: 956_369,
                  total_count: 1,
                },
              ],
            }
          : { rows: [row] };
      },
    },
    "livenet",
    "work",
    new URLSearchParams({ address: senderAddress }),
    { limit: 25, offset: 0, page: 0, query: "", snapshotId: "" },
  );
  assert.equal(historyPage.source, "proof-indexer-token-invalid-events");
  assert.equal(historyPage.kind, "invalidEvents");
  assert.equal(historyPage.totalCount, 1);
  assert.equal(historyPage.items[0].valid, false);
  assert.equal(historyPage.indexedThroughBlock, 957_598);
  assert.deepEqual(historyQueries[0].params, [
    "livenet",
    "work",
    `%${senderAddress}%`,
  ]);
  assert.deepEqual(historyQueries[1].params.slice(-2), [25, 0]);
  assert.match(
    historyQueries[0].sql,
    /FROM proof_indexer\.event_participants epq/u,
  );

  const sentinelPage = { source: "live-invalid-history" };
  const proofIndexTokenHistoryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenHistoryPayload",
    {
      currentTokenInvalidEventHistoryPage: async () => sentinelPage,
      normalizedTxid,
      proofIndexPool: () => ({}),
      proofIndexTokenHistoryReadEligibility: () => ({
        eligible: true,
        kind: "invalidEvents",
        pagination: {
          limit: 25,
          offset: 0,
          page: 0,
          query: "",
          snapshotId: "",
        },
        scope: "work",
      }),
      tokenHistoryFilterNeedles: () => [],
      tokenHistoryMarketEventKinds: () => [],
    },
  );
  assert.equal(
    await proofIndexTokenHistoryPayload(
      "livenet",
      "work",
      "invalid-events",
      new URLSearchParams({ address: senderAddress }),
    ),
    sentinelPage,
  );
});

check("unpinned mint and market history use current relational pages", async () => {
  const scan = {
    generated_at: "2026-07-11T12:00:00.000Z",
    indexed_through_block: 957_619,
  };
  const currentRelationalHistoryPageWithScanCoverage = isolatedFunction(
    READER_PATH,
    "currentRelationalHistoryPageWithScanCoverage",
    {
      dateIso: (value) => new Date(value).toISOString(),
      newestDateIso: (values) => values.filter(Boolean).sort().at(-1),
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
    },
  );
  const mintPage = {
    cursor: "0",
    indexedAt: "2026-07-10T12:00:00.000Z",
    indexedThroughBlock: 957_417,
    items: [{ txid: "1".repeat(64) }],
    source: "proof-indexer-token-mint-events",
  };
  const marketPage = {
    cursor: "0",
    indexedAt: "2026-07-10T13:00:00.000Z",
    indexedThroughBlock: 957_408,
    items: [{ txid: "2".repeat(64) }],
    source: "proof-indexer-token-events",
  };
  let embeddedSnapshotReads = 0;
  let mintReads = 0;
  let marketReads = 0;
  const proofIndexTokenHistoryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenHistoryPayload",
    {
      currentRelationalHistoryPageWithScanCoverage,
      exactTokenMintHistoryPage: async (
        _pool,
        _network,
        _scope,
        _searchParams,
        _pagination,
        snapshot,
      ) => {
        mintReads += 1;
        assert.equal(snapshot, null);
        return mintPage;
      },
      latestProofIndexScanMetadata: async () => scan,
      ledgerSnapshotWithPayload: async () => {
        embeddedSnapshotReads += 1;
        return null;
      },
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "").toLowerCase())
          ? String(value).toLowerCase()
          : "",
      proofIndexPool: () => ({}),
      proofIndexTokenHistoryReadEligibility: (_scope, kind) => ({
        eligible: true,
        kind,
        pagination: {
          limit: 10,
          offset: 0,
          page: 0,
          query: "",
          snapshotId: "",
        },
        scope: "all",
      }),
      proofIndexTokenMarketHistoryOverlayPayload: async (
        _network,
        _scope,
        _kind,
        _searchParams,
        options,
      ) => {
        marketReads += 1;
        assert.equal(options.snapshot.snapshot_id, "");
        return marketPage;
      },
      tokenHistoryFilterNeedles: () => [],
      tokenHistoryMarketEventKinds: (kind) =>
        kind === "market-log" ? ["token-listing"] : [],
    },
  );

  const mintResult = await proofIndexTokenHistoryPayload(
    "livenet",
    "",
    "mints",
    new URLSearchParams({ limit: "10" }),
  );
  const marketResult = await proofIndexTokenHistoryPayload(
    "livenet",
    "work",
    "market-log",
    new URLSearchParams({ limit: "10" }),
  );

  assert.equal(mintReads, 1);
  assert.equal(marketReads, 1);
  assert.equal(embeddedSnapshotReads, 0);
  assert.equal(mintResult.source, "proof-indexer-token-mint-events");
  assert.equal(marketResult.source, "proof-indexer-token-events");
  assert.equal(mintResult.indexedThroughBlock, 957_619);
  assert.equal(marketResult.indexedThroughBlock, 957_619);
  assert.equal(mintResult.indexedAt, scan.generated_at);
  assert.equal(marketResult.indexedAt, scan.generated_at);
});

check("invalid listing attempts inherit their canonical credit scope", () => {
  const txid = "a".repeat(64);
  const tokenInvalidEventQueryParts = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventQueryParts",
    {
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value)) ? String(value) : "",
      tokenHistoryFilterNeedles: (_params, pagination) => [pagination.query],
      tokenScopeKey: (scope) => String(scope).toLowerCase(),
    },
  );
  const query = tokenInvalidEventQueryParts(
    "livenet",
    "work",
    new URLSearchParams({ q: txid }),
    { query: txid },
  );
  assert.match(query.fromSql, /proof_indexer\.credit_listings cl_invalid/u);
  assert.match(query.fromSql, /lower\(cl_invalid\.token_id\) = \$2/u);
  assert.deepEqual(Array.from(query.params[2]), [txid]);
});

check("public Log counts only valid confirmed or pending actions", async () => {
  const readerSource = fileSource(READER_PATH);
  const publicKinds = /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    readerSource,
  )?.[1] ?? "";
  assert.doesNotMatch(publicKinds, /"token-event-invalid"/u);
  assert.match(
    topLevelFunctionSource(READER_PATH, "normalizeHistoryEventItem"),
    /publicOnly[\s\S]*item\?\.valid === false/u,
  );

  let activitySql = "";
  let activityParams = [];
  const rows = Array.from({ length: 23_585 }, (_, index) => ({
    event_time: "2026-07-11T12:00:00.000Z",
    txid: index.toString(16).padStart(64, "0"),
  }));
  const proofIndexCanonicalActivityPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalActivityPayload",
    {
      indexedThroughBlockFromItems: () => 950_123,
      latestProofIndexScanMetadata: async () => null,
      newestDateIso: () => "2026-05-20T12:00:00.000Z",
      normalizeHistoryEventRows: (items) =>
        items.map((item) => ({ confirmed: true, txid: item.txid })),
      PUBLIC_LOG_EVENT_KINDS: new Set(["mail", "token-mint"]),
      proofIndexPool: () => ({
        async query(sql, params) {
          activitySql = String(sql);
          activityParams = params;
          return { rows };
        },
      }),
      rowNumber: () => 0,
    },
  );
  const activity = await proofIndexCanonicalActivityPayload("livenet");
  assert.equal(activity.stats.confirmed, 23_585);
  assert.equal(activity.stats.total, 23_585);
  assert.match(activitySql, /e\.valid = true/u);
  assert.match(activitySql, /e\.status IN \('confirmed', 'pending'\)/u);
  assert.match(activitySql, /e\.kind = ANY\(\$2::text\[\]\)/u);
  assert.doesNotMatch(activitySql, /token-event-invalid/u);
  assert.deepEqual(Array.from(activityParams[1]), ["mail", "token-mint"]);

  const logHistorySource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexLogHistoryPayload",
  );
  assert.match(logHistorySource, /"e\.valid = true"/u);
  assert.match(
    logHistorySource,
    /"e\.status IN \('confirmed', 'pending'\)"/u,
  );
  assert.match(logHistorySource, /"e\.kind = ANY\(\$2::text\[\]\)"/u);
});

check("canonical Log membership is event-bounded and snapshot fenced", async () => {
  const txid = "9".repeat(64);
  const snapshotTime = "2026-07-14T12:00:00.000Z";
  const reads = [];
  const proofIndexCanonicalActivityPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalActivityPayload",
    {
      indexedThroughBlockFromItems: () => 100,
      ledgerSnapshotMetadata: async () => ({
        generated_at: snapshotTime,
        indexed_through_block: 105,
        snapshot_id: "snapshot-105",
      }),
      latestProofIndexScanMetadata: async () => null,
      newestDateIso: () => snapshotTime,
      normalizeHistoryEventRows: (rows) =>
        rows.map((row) => ({
          canonicalMinerFeeCovered:
            row.canonical_miner_fee_covered === true,
          confirmed: row.status === "confirmed",
          eventId: Number(row.event_id),
          kind: "token-transfer",
          network: "livenet",
          txid: row.txid,
        })),
      normalizedTxid: (value) => String(value ?? "").trim().toLowerCase(),
      PUBLIC_LOG_EVENT_KINDS: new Set(["token-transfer"]),
      proofIndexPool: () => ({
        async query(sql, params) {
          reads.push({ params, sql: String(sql) });
          return {
            rows: [{
              canonical_miner_fee_covered: true,
              canonical_miner_fee_sats: 846,
              event_id: 42,
              status: "confirmed",
              txid,
            }],
          };
        },
      }),
      rowNumber: (row, key) => Number(row?.[key]) || 0,
    },
  );

  const membership = await proofIndexCanonicalActivityPayload("livenet", {
    eventIds: [42, 42],
    snapshotId: "snapshot-105",
  });
  assert.equal(membership.membershipRestricted, true);
  assert.deepEqual(Array.from(membership.membershipEventIds), [42]);
  assert.equal(membership.activity[0].eventId, 42);
  assert.equal(membership.canonicalMinerFeeCoverage.complete, true);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].params[0], "livenet");
  assert.deepEqual(Array.from(reads[0].params[1]), ["token-transfer"]);
  assert.equal(reads[0].params[2], 105);
  assert.equal(reads[0].params[3], snapshotTime);
  assert.deepEqual(Array.from(reads[0].params[4]), [42]);
  assert.match(
    reads[0].sql,
    /e\.event_id = ANY\(\$5::bigint\[\]\)/u,
  );
  assert.match(
    reads[0].sql,
    /e\.updated_at <= \$4::timestamptz/u,
  );
  assert.match(
    reads[0].sql,
    /transaction_row\.updated_at <= \$4::timestamptz/u,
  );
  assert.match(
    reads[0].sql,
    /canonical_block\.indexed_at <= \$4::timestamptz/u,
  );
  assert.equal(
    await proofIndexCanonicalActivityPayload("livenet", {
      eventIds: [],
      snapshotId: "snapshot-105",
    }),
    null,
  );
  assert.equal(reads.length, 1);
});

check("canonical miner-fee coverage fails closed on partial normalized rows", async () => {
  const txid = "c".repeat(64);
  let activitySql = "";
  const proofIndexCanonicalActivityPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalActivityPayload",
    {
      indexedThroughBlockFromItems: () => 957_950,
      latestProofIndexScanMetadata: async () => null,
      newestDateIso: () => "2026-07-13T23:14:00.000Z",
      normalizeHistoryEventRows: (rows) =>
        rows.map((row) => ({ confirmed: true, txid: row.txid })),
      normalizedTxid: (value) => String(value ?? "").trim().toLowerCase(),
      PUBLIC_LOG_EVENT_KINDS: new Set(["token-transfer"]),
      proofIndexPool: () => ({
        async query(sql) {
          activitySql = String(sql);
          return {
            rows: [
              {
                canonical_miner_fee_covered: true,
                canonical_miner_fee_sats: 846,
                status: "confirmed",
                txid,
              },
              {
                canonical_miner_fee_covered: false,
                status: "confirmed",
                txid,
              },
            ],
          };
        },
      }),
      rowNumber: () => 0,
    },
  );
  const activity = await proofIndexCanonicalActivityPayload("livenet");
  assert.equal(activity.canonicalMinerFeeCoverage.complete, false);
  assert.equal(
    activity.canonicalMinerFeeCoverage.missingConfirmedTransactions,
    1,
  );
  assert.equal(activity.canonicalMinerFeeCoverage.confirmedEvents, 2);
  assert.equal(activity.canonicalMinerFeeCoverage.coveredConfirmedEvents, 1);
  assert.equal(activity.canonicalMinerFeeCoverage.missingConfirmedEvents, 1);
  assert.deepEqual(
    Array.from(activity.canonicalMinerFeeCoverage.missingConfirmedTxids),
    [txid],
  );
  assert.match(
    activitySql,
    /jsonb_typeof\(\s*transaction_row\.raw_tx->'canonicalBlockScan'\s*\)\s*=\s*'object'/u,
  );
  assert.equal(
    (
      activitySql.match(
        /input_totals\.input_count\s*=\s*jsonb_array_length\(transaction_row\.raw_tx->'vin'\)/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    activitySql,
    /output_totals\.output_count\s*=\s*jsonb_array_length\(\s*CASE[\s\S]*?raw_tx->'vout'[\s\S]*?ELSE '\[\]'::jsonb/u,
  );
  assert.match(
    activitySql,
    /COUNT\(o\.value_sats\)::integer AS valued_output_count/u,
  );
  assert.equal(
    (
      activitySql.match(
        /output_totals\.valued_output_count\s*=\s*output_totals\.output_count/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (activitySql.match(/jsonb_exists\([\s\S]*?'coinbase'[\s\S]*?\)/gu) ?? [])
      .length,
    5,
  );
  assert.match(
    activitySql,
    /THEN CASE\s+WHEN jsonb_exists\([\s\S]*?'coinbase'[\s\S]*?\) THEN 0/u,
  );
  assert.equal(
    (
      activitySql.match(
        /NOT jsonb_exists\([\s\S]*?'coinbase'[\s\S]*?\)\s+AND\s+input_totals\.input_count > 0/gu,
      ) ?? []
    ).length,
    2,
  );
});

check("canonical coinbase activity is covered with a zero miner fee", async () => {
  const txid = "e".repeat(64);
  const proofIndexCanonicalActivityPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalActivityPayload",
    {
      indexedThroughBlockFromItems: () => 957_950,
      latestProofIndexScanMetadata: async () => null,
      newestDateIso: () => "2026-07-13T23:14:00.000Z",
      normalizeHistoryEventRows: (rows) =>
        rows.map((row) => ({
          canonicalMinerFeeCovered:
            row.canonical_miner_fee_covered === true,
          confirmed: true,
          minerFeeSats: Number(row.canonical_miner_fee_sats),
          txid: row.txid,
        })),
      normalizedTxid: (value) => String(value ?? "").trim().toLowerCase(),
      PUBLIC_LOG_EVENT_KINDS: new Set(["token-transfer"]),
      proofIndexPool: () => ({
        async query() {
          return {
            rows: [
              {
                canonical_miner_fee_covered: true,
                canonical_miner_fee_sats: 0,
                status: "confirmed",
                txid,
              },
            ],
          };
        },
      }),
      rowNumber: () => 0,
    },
  );
  const activity = await proofIndexCanonicalActivityPayload("livenet");
  assert.equal(activity.canonicalMinerFeeCoverage.complete, true);
  assert.equal(activity.canonicalMinerFeeCoverage.confirmedEvents, 1);
  assert.equal(activity.canonicalMinerFeeCoverage.confirmedTransactions, 1);
  assert.equal(activity.activity[0].canonicalMinerFeeCovered, true);
  assert.equal(activity.activity[0].minerFeeSats, 0);
});

check("canonical consistency aggregates participants across same-tx events", () => {
  const activityCoverageByTxidKind = isolatedFunction(
    API_PATH,
    "activityCoverageByTxidKind",
  );
  const txid = "7".repeat(64);
  const coverage = activityCoverageByTxidKind([
    {
      kind: "token-listing-closed",
      participants: ["bc1seller", "bc1registry"],
      txid,
    },
    {
      kind: "token-listing-closed",
      participants: ["bc1buyer"],
      txid,
    },
  ]).get(`token-listing-closed:${txid}`);
  assert.equal(coverage.items, 2);
  assert.deepEqual(
    [...coverage.participants].sort(),
    ["bc1buyer", "bc1registry", "bc1seller"],
  );
});

check("canonical consistency rejects zero token components behind token activity", () => {
  const tokenComponentCoverageFromConfirmedActivity = isolatedFunction(
    API_PATH,
    "tokenComponentCoverageFromConfirmedActivity",
  );
  const missing = tokenComponentCoverageFromConfirmedActivity(
    [
      { confirmed: true, kind: "token-create" },
      { confirmed: true, kind: "token-mint" },
      { confirmed: true, kind: "token-transfer" },
      { confirmed: true, kind: "token-sale" },
    ],
    { mints: [], sales: [], tokens: [], transfers: [] },
  );
  assert.equal(missing.ok, false);
  assert.deepEqual(Array.from(missing.missing).sort(), [
    "mints",
    "sales",
    "tokens",
    "transfers",
  ]);

  const complete = tokenComponentCoverageFromConfirmedActivity(
    [
      { confirmed: true, kind: "token-create" },
      { confirmed: true, kind: "token-mint" },
      { confirmed: true, kind: "token-transfer" },
      { confirmed: true, kind: "token-sale" },
    ],
    {
      mints: [{ confirmed: true }],
      sales: [{ confirmed: true }],
      tokens: [{ confirmed: true }],
      transfers: [{ confirmed: true }],
    },
  );
  assert.equal(complete.ok, true);
  assert.deepEqual(Array.from(complete.missing), []);
});

check("canonical activity counts exactly match the public Log", () => {
  const canonicalActivityCountCoverage = isolatedFunction(
    API_PATH,
    "canonicalActivityCountCoverage",
    {
      numericValue: (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      },
    },
  );
  assert.equal(
    canonicalActivityCountCoverage(
      { activityItems: 3, confirmedComputerActions: 2 },
      { activity: { count: 2, confirmed: 2 } },
    ).ok,
    false,
  );
  assert.equal(
    canonicalActivityCountCoverage(
      { activityItems: 2, confirmedComputerActions: 2 },
      { activity: { count: 2, confirmed: 1 } },
    ).ok,
    false,
  );
  assert.equal(
    canonicalActivityCountCoverage(
      { activityItems: 2, confirmedComputerActions: 1 },
      { activity: { count: 2, confirmed: 1 } },
    ).ok,
    true,
  );
});

check("synthetic WORK, POWB, and INCB definitions are not public Log actions", () => {
  const tokenStateLogExpectations = isolatedFunction(
    API_PATH,
    "tokenStateLogExpectations",
    {
      BOND_TOKEN_IDS: new Set(["powb", "incb"]),
      POWB_TOKEN_ID: "powb",
      WORK_TOKEN_ID: "work",
    },
  );
  const expectations = tokenStateLogExpectations({
    closedListings: [],
    listings: [],
    mints: [],
    sales: [],
    tokens: [
      { confirmed: true, tokenId: "work", txid: "a".repeat(64) },
      { confirmed: true, tokenId: "powb", txid: "b".repeat(64) },
      { confirmed: true, tokenId: "incb", txid: "d".repeat(64) },
      { confirmed: true, tokenId: "real", txid: "c".repeat(64) },
    ],
    transfers: [],
  });
  assert.deepEqual(
    Array.from(expectations, (item) => item.tokenId),
    ["real"],
  );
});

check("stale registry age can be bypassed only with explicit current tip coverage", async () => {
  let tipHeight;
  const proofIndexPayloadHasExplicitCurrentCoverage = isolatedFunction(
    API_PATH,
    "proofIndexPayloadHasExplicitCurrentCoverage",
    {
      PROOF_INDEX_CONFIRMED_READ_MAX_LAG_BLOCKS: 6,
      ledgerTipHeight: async () => tipHeight,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock),
    },
  );
  assert.equal(
    await proofIndexPayloadHasExplicitCurrentCoverage(
      { indexedThroughBlock: 100 },
      "livenet",
    ),
    false,
  );
  tipHeight = 105;
  assert.equal(
    await proofIndexPayloadHasExplicitCurrentCoverage(
      { indexedThroughBlock: 100 },
      "livenet",
    ),
    true,
  );
  tipHeight = 107;
  assert.equal(
    await proofIndexPayloadHasExplicitCurrentCoverage(
      { indexedThroughBlock: 100 },
      "livenet",
    ),
    false,
  );
});

check("stored canonical summaries require component and public Log count checks", () => {
  const eligibleCanonicalSummarySnapshotPayload = isolatedFunction(
    BACKFILL_PATH,
    "eligibleCanonicalSummarySnapshotPayload",
    {
      canonicalSummaryAccountingModelsCurrent: () => true,
      canonicalSummaryCoverage: () => 957_641,
      exactSummarySnapshotTotalsCurrent: () => true,
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
    },
  );
  const payload = {
    checks: [],
    indexedThroughBlockHash: "b".repeat(64),
    ok: true,
    sourceHashes: { canonicalSummary: "a".repeat(64) },
    status: "green",
    summaryPayloads: {},
    summaryRefresh: {
      indexedThroughBlockHash: "b".repeat(64),
      mode: "canonical-summary-refresh",
    },
  };
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), false);
  payload.checks.push({
    name: "token-components-cover-confirmed-activity",
    ok: true,
  });
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), false);
  payload.checks.push({
    name: "canonical-activity-count-matches-public-log",
    ok: true,
  });
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), false);
  payload.checks.push({
    name: "inception-live-issuance-matches-incb-supply",
    ok: true,
  });
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), false);
  payload.checks.push({
    name: "inception-fixed-value-reconciles",
    ok: true,
  });
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), true);

  const snapshotReadSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexSnapshotPayload",
  );
  assert.match(
    snapshotReadSource,
    /token-components-cover-confirmed-activity/u,
  );
  assert.match(
    snapshotReadSource,
    /canonical-activity-count-matches-public-log/u,
  );
  assert.match(snapshotReadSource, /check_item->>'ok'[\s\S]*'true'/u);
});

check("current snapshot readers require atomic WORK markers while pinned history bypasses them", async () => {
  const normalizedSnapshotId = isolatedFunction(
    READER_PATH,
    "normalizedSnapshotId",
  );
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ params: Array.from(params), sql: String(sql) });
      return { rows: [] };
    },
  };
  const ledgerSnapshot = isolatedFunction(
    READER_PATH,
    "ledgerSnapshot",
    {
      WORK_ATOMIC_PROJECTION_MODEL,
      normalizedSnapshotId,
    },
  );
  const ledgerSnapshotMetadata = isolatedFunction(
    READER_PATH,
    "ledgerSnapshotMetadata",
    {
      WORK_ATOMIC_PROJECTION_MODEL,
      normalizedSnapshotId,
    },
  );
  const ledgerSnapshotWithPayload = isolatedFunction(
    READER_PATH,
    "ledgerSnapshotWithPayload",
    {
      WORK_ATOMIC_PROJECTION_MODEL,
      ledgerSnapshot,
      normalizedSnapshotId,
    },
  );
  const tokenStateSnapshotForScope = isolatedFunction(
    READER_PATH,
    "tokenStateSnapshotForScope",
    {
      LEDGER_SNAPSHOT_RECENT_READ_LIMIT: 25,
      WORK_ATOMIC_PROJECTION_MODEL,
      normalizedSnapshotId,
      tokenScopeKey: (value) => String(value ?? "").trim().toLowerCase(),
    },
  );

  await ledgerSnapshot(pool, "livenet");
  await ledgerSnapshotMetadata(pool, "livenet");
  await ledgerSnapshotWithPayload(
    pool,
    "livenet",
    "",
    "activityPayload",
  );
  await tokenStateSnapshotForScope(
    pool,
    "livenet",
    "",
    WORK_TOKEN_ID,
  );
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.match(call.sql, /workAmountStorageModel/u);
    assert.equal(
      call.params.at(-1),
      WORK_ATOMIC_PROJECTION_MODEL,
    );
  }

  calls.length = 0;
  const pinned = "h-minus-one-snapshot";
  await ledgerSnapshot(pool, "livenet", pinned);
  await ledgerSnapshotMetadata(pool, "livenet", pinned);
  await ledgerSnapshotWithPayload(
    pool,
    "livenet",
    pinned,
    "summaryPayloads",
  );
  await tokenStateSnapshotForScope(
    pool,
    "livenet",
    pinned,
    WORK_TOKEN_ID,
  );
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /workAmountStorageModel/u);
    assert.ok(call.params.includes(pinned));
  }

  calls.length = 0;
  const proofIndexSnapshotPayload = isolatedFunction(
    READER_PATH,
    "proofIndexSnapshotPayload",
    {
      SUMMARY_SNAPSHOT_LOOKBACK_LIMIT: 5_000,
      WORK_ATOMIC_PROJECTION_MODEL,
      proofIndexPool: () => pool,
    },
  );
  assert.equal(
    await proofIndexSnapshotPayload("livenet", "workFloor"),
    null,
  );
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(
      call.sql,
      /payload->>'workAmountStorageModel' = \$3/u,
    );
    assert.deepEqual(call.params, [
      "livenet",
      "workFloor",
      WORK_ATOMIC_PROJECTION_MODEL,
    ]);
    assert.match(call.sql, /workNetworkValueAccountingModel/u);
    assert.match(call.sql, /workNetworkValueQ8/u);
  }
});

check("backfill current snapshot selectors require atomic WORK markers while exact H-1 reads bypass them", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ params: Array.from(params), sql: String(sql) });
      return { rows: [] };
    },
  };
  const storedLedgerSnapshotPayload = isolatedFunction(
    BACKFILL_PATH,
    "storedLedgerSnapshotPayload",
    {
      NETWORK: "livenet",
      WORK_ATOMIC_PROJECTION_MODEL,
    },
  );
  const storedEligibleCanonicalSummarySnapshotPayload =
    isolatedFunction(
      BACKFILL_PATH,
      "storedEligibleCanonicalSummarySnapshotPayload",
      {
        NETWORK: "livenet",
        WORK_ATOMIC_PROJECTION_MODEL,
        eligibleCanonicalSummarySnapshotPayload: () => false,
      },
    );

  await storedLedgerSnapshotPayload(client);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].sql,
    /payload->>'workAmountStorageModel' = \$2/u,
  );
  assert.deepEqual(calls[0].params, [
    "livenet",
    WORK_ATOMIC_PROJECTION_MODEL,
  ]);

  calls.length = 0;
  await storedLedgerSnapshotPayload(
    client,
    "h-minus-one-snapshot",
    { requireSummaryPayloads: true },
  );
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /workAmountStorageModel/u);
  assert.match(calls[0].sql, /snapshot_id = \$2/u);
  assert.deepEqual(calls[0].params, [
    "livenet",
    "h-minus-one-snapshot",
  ]);

  calls.length = 0;
  await storedEligibleCanonicalSummarySnapshotPayload(client);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].sql,
    /payload->>'workAmountStorageModel' = \$2/u,
  );
  assert.match(calls[0].sql, /workNetworkValueAccountingModel/u);
  assert.deepEqual(calls[0].params, [
    "livenet",
    WORK_ATOMIC_PROJECTION_MODEL,
  ]);
});

check("ledger consistency requires fixed Inception issuance plus market flow", () => {
  const snapshotChecksSource = topLevelFunctionSource(
    API_PATH,
    "ledgerSnapshotChecks",
  );
  const currentLedgerSource = topLevelFunctionSource(
    API_PATH,
    "ledgerPayloadHasCurrentChecks",
  );
  assert.match(
    snapshotChecksSource,
    /"inception-fixed-value-reconciles"/u,
  );
  assert.match(
    snapshotChecksSource,
    /inceptionIssuanceNetworkValueQ8\s*\+[\s\S]*inceptionSaleVolume\s*\+[\s\S]*inceptionTransferFee\s*\+[\s\S]*inceptionMarketplaceMutationFee[\s\S]*BOND_VALUE_Q8_SCALE/u,
  );
  assert.match(
    snapshotChecksSource,
    /INCEPTION_NETWORK_VALUE_ACCOUNTING_MODEL/u,
  );
  assert.match(
    currentLedgerSource,
    /checkNames\.has\("inception-fixed-value-reconciles"\)/u,
  );
});

check("credit frozen-value consistency uses exact Q8 above float precision", () => {
  const snapshotChecksSource = topLevelFunctionSource(
    API_PATH,
    "ledgerSnapshotChecks",
  );
  const exactCreditFrozenValueComponentsAgree = isolatedFunction(
    API_PATH,
    "exactCreditFrozenValueComponentsAgree",
    {
      VALUE_Q8_SCALE,
      canonicalIntegerText,
    },
  );
  const movementQ8 = 7_575_762_473_548_365_123_456_78n;
  const flows = {
    creditMinerFeeFlowSats: 8_192_163,
    creditMarketplaceMutationFlowSats: 215_670,
    creditProofPaymentFlowSats: 21_000_000,
    creditRegistryMutationFlowSats: 68_796,
    creditSalePaymentFlowSats: 8_728_286,
  };
  const fixedFlow = Object.values(flows).reduce(
    (total, value) => total + BigInt(value),
    0n,
  );
  const exact = {
    ...flows,
    // The legacy Number summaries can disagree by one whole proof at this
    // magnitude even though every event component is exact.
    creditEventFrozenValueSats: 7_575_762_511_753_281,
    creditEventFrozenValueQ8:
      (movementQ8 + fixedFlow * VALUE_Q8_SCALE).toString(),
    creditMovementFrozenValueSats: 7_575_762_473_548_365,
    creditMovementFrozenValueQ8: movementQ8.toString(),
  };
  assert.equal(exactCreditFrozenValueComponentsAgree(exact), true);
  assert.equal(
    exactCreditFrozenValueComponentsAgree({
      ...exact,
      creditEventFrozenValueQ8:
        (BigInt(exact.creditEventFrozenValueQ8) + 1n).toString(),
    }),
    false,
  );
  assert.equal(
    exactCreditFrozenValueComponentsAgree({
      ...exact,
      creditEventFrozenValueQ8: undefined,
    }),
    false,
  );
  assert.equal(
    exactCreditFrozenValueComponentsAgree({
      ...exact,
      creditEventFrozenValueQ8: undefined,
      creditMovementFrozenValueQ8: undefined,
    }),
    null,
  );
  assert.equal(
    exactCreditFrozenValueComponentsAgree({
      ...exact,
      creditMinerFeeFlowSats: undefined,
    }),
    false,
  );
  assert.match(
    snapshotChecksSource,
    /exactCreditFrozenComponents\s*===\s*true\s*\|\|[\s\S]*exactCreditFrozenComponents\s*===\s*null\s*&&[\s\S]*numbersAgree/u,
  );
});

check("bond value uses confirmed payments instead of synthetic mint payment fields", () => {
  const POWB_TOKEN_ID = "powb";
  const bondAmounts = [
    ...Array.from({ length: 464 }, () => 1_000_000),
    166_196_569,
  ];
  const bonds = bondAmounts.map((amountSats, index) => ({
    amountSats,
    confirmed: true,
    createdAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    kind: "infinity-bond",
    txid: index.toString(16).padStart(64, "0"),
  }));
  const tokenState = {
    confirmedSupply: 630_196_569,
    holders: [{ address: "bc1holder", balance: 630_196_569 }],
    listings: [],
    mints: bonds.map((bond) => ({
      amount: bond.amountSats,
      confirmed: true,
      paidSats: 0,
      tokenId: POWB_TOKEN_ID,
      txid: bond.txid,
    })),
    pendingSupply: 0,
    sales: [],
    source: "fixture",
    tokens: [{ registryAddress: "bc1registry", tokenId: POWB_TOKEN_ID }],
    transfers: Array.from({ length: 4 }, (_, index) => ({
      confirmed: true,
      paidSats: 546,
      tokenId: POWB_TOKEN_ID,
      txid: `t${index}`,
    })),
  };
  const mutations = Array.from({ length: 2 }, (_, index) => ({
    amountSats: 546,
    confirmed: true,
    kind: "token-listing",
    tokenId: POWB_TOKEN_ID,
    txid: `m${index}`,
  }));
  const bondSummaryPayloadFromLedger = isolatedFunction(
    API_PATH,
    "bondSummaryPayloadFromLedger",
    {
      INCB_TOKEN_ID: "incb",
      INCEPTION_ATTACHMENT_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set(["token-listing"]),
      activityAmountSats: (item) => Number(item?.amountSats ?? 0),
      attachLedgerMetadata: (payload) => payload,
      bondAttachedWorkValueDetails: () => ({
        attachedWorkActions: 0,
        attachedWorkAmount: 0,
        attachedWorkFrozenValueByTxid: new Map(),
        attachedWorkFrozenValueSats: 0,
        attachedWorkLiveValueSats: 0,
        attachedWorkUnmatchedActions: 0,
        attachedWorkUnvaluedActions: 0,
      }),
      btcUsdResponseMetadata: () => ({ btcUsd: 0 }),
      compactTokenSummaryPayload: (state) => state,
      infinityBondChartPointsFromEvents: ({ bonds: items }) =>
        items.length > 0 ? [{ txid: items.at(-1).txid }] : [],
      isBondActivityItem: (item, config) =>
        item?.kind === config.kind,
      ledgerTokenStateForScope: (ledger) => ledger.tokenState,
      numericValue: (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
      },
      satsToUsdAtBtcUsd: () => 0,
    },
  );
  const summary = bondSummaryPayloadFromLedger(
    {
      activity: [...bonds, ...mutations],
      generatedAt: "2026-07-11T12:00:00.000Z",
      network: "livenet",
      tokenState,
    },
    {
      kind: "infinity-bond",
      registryId: "infinity@proofofwork.me",
      ticker: "POWB",
      tokenId: POWB_TOKEN_ID,
    },
  );
  assert.equal(summary.stats.confirmedBondActions, 465);
  assert.equal(summary.actualValue.bondMintFlowSats, "630196569");
  assert.equal(summary.actualValue.bondTransferFeeSats, "2184");
  assert.equal(summary.actualValue.bondMarketplaceMutationFeeSats, "1092");
  assert.equal(summary.networkValueSats, "630199845");
  assert.ok(Math.abs(Number(summary.floorSats) - 1.00000519) < 1e-8);
  assert.doesNotMatch(
    topLevelFunctionSource(API_PATH, "bondSummaryPayloadFromLedger"),
    /bondMintFlowSats[\s\S]*mint\.paidSats/u,
  );
});

check("Inception fixes attachment value at issuance and adds only later INCB market flow", () => {
  const INCB_TOKEN_ID = "incb";
  const INCEPTION_ISSUANCE_ACCOUNTING_MODEL =
    "canonical-pre-bond-live-network-value-v2";
  const INCEPTION_NETWORK_VALUE_ACCOUNTING_MODEL =
    "fixed-incb-issuance-plus-market-flow-v1";
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const WORK_TOKEN_ID = "work";
  const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
  const txid = "d".repeat(64);
  const blockHash = "e".repeat(64);
  const blockHeight = 957_950;
  const blockIndex = 382;
  const recipientAddress = "bc1inceptionrecipient";
  const numericValue = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const testTokenLedgerAmountFields = (tokenId, amount) =>
    tokenId === WORK_TOKEN_ID
      ? {
          amount: Number(formatWorkAtoms(amount)),
          amountAtoms: String(amount),
          amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : { amount: Number(amount) };
  const ledgerTokenStateForScope = (ledger, tokenId) =>
    tokenId === WORK_TOKEN_ID ? ledger.workTokenState : ledger.tokenState;
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID,
      canonicalEventOrdinal,
      ledgerTokenStateForScope,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const inceptionIssuanceMetadataFromMints = isolatedFunction(
    API_PATH,
    "inceptionIssuanceMetadataFromMints",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      WORK_TOKEN_MAX_SUPPLY,
      numbersAgree: (left, right, tolerance = 0) =>
        Math.abs(Number(left) - Number(right)) <= tolerance,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const inceptionInvalidMintDispositionMatchesBond = isolatedFunction(
    API_PATH,
    "inceptionInvalidMintDispositionMatchesBond",
    {
      INCB_TOKEN_ID,
      INCEPTION_BOND_CONFIG: { kind: "inception-bond" },
    },
  );
  const inceptionBondHasExplicitlyRejectedMint = isolatedFunction(
    API_PATH,
    "inceptionBondHasExplicitlyRejectedMint",
    {
      INCB_TOKEN_ID,
      inceptionInvalidMintDispositionMatchesBond,
    },
  );
  const inceptionVerifierBondActivity = isolatedFunction(
    API_PATH,
    "inceptionVerifierBondActivity",
    {
      inceptionBondHasExplicitlyRejectedMint,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
    },
  );
  const bondAttachedWorkValueDetails = isolatedFunction(
    API_PATH,
    "bondAttachedWorkValueDetails",
    {
      INCB_TOKEN_ID,
      Map,
      WORK_TOKEN_ID,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceMetadataFromMints,
      ledgerTokenStateForScope,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const isBondActivityItem = (item, config) => item?.kind === config.kind;
  const activityAmountSats = (item) => numericValue(item?.amountSats);
  const infinityBondChartPointsFromEvents = isolatedFunction(
    API_PATH,
    "infinityBondChartPointsFromEvents",
    {
      INFINITY_BOND_CONFIG: {},
      Map,
      activityAmountSats,
      canonicalTokenReplayOrdinal: (item) =>
        Number(item?.protocolVout ?? Number.MAX_SAFE_INTEGER),
      isBondActivityItem,
      numericValue,
    },
  );
  const bondSummaryPayloadFromLedger = isolatedFunction(
    API_PATH,
    "bondSummaryPayloadFromLedger",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      INCEPTION_NETWORK_VALUE_ACCOUNTING_MODEL,
      INCEPTION_ATTACHMENT_ACCOUNTING_MODEL:
        INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      activityAmountSats,
      attachLedgerMetadata: (payload) => payload,
      bondAttachedWorkValueDetails,
      btcUsdResponseMetadata: () => ({ btcUsd: 0 }),
      compactTokenSummaryPayload: (state) => state,
      infinityBondChartPointsFromEvents,
      inceptionBondHasExplicitlyRejectedMint,
      inceptionIssuanceMetadataFromMints,
      isBondActivityItem,
      ledgerTokenStateForScope,
      numericValue,
      satsToUsdAtBtcUsd: () => 0,
    },
  );
  const config = {
    kind: "inception-bond",
    registryId: "inception@proofofwork.me",
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
  };
  const bond = {
    amountSats: 546,
    attachedCredits: [
      {
        amount: 100,
        protocolVout: 3,
        recipientAddress,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    confirmed: true,
    createdAt: "2026-07-13T03:14:00.000Z",
    blockHash,
    blockHeight,
    blockIndex,
    kind: config.kind,
    recipients: [{ address: recipientAddress, amountSats: 546, vout: 0 }],
    txid,
  };
  const inceptionMint = ({
    attachedWorkAmount = 100,
    attachedWorkLiveValueAtSendSats = 200,
  } = {}) => {
    const issuanceNetworkValueSats =
      546 + attachedWorkLiveValueAtSendSats;
    const confirmedIssuanceUnits = Math.floor(issuanceNetworkValueSats);
    return {
      amount: confirmedIssuanceUnits,
      amountSats: 0,
      attachedWorkAmount,
      attachedWorkLiveFloorAtSendSats:
        attachedWorkAmount > 0
          ? attachedWorkLiveValueAtSendSats / attachedWorkAmount
          : 0,
      attachedWorkIssuanceUnits: confirmedIssuanceUnits - 546,
      attachedWorkLiveValueAtSendSats,
      bondRecipientAddress: recipientAddress,
      bondRecipientAmountSats: 546,
      bondRecipientVout: 0,
      blockHash,
      blockHeight,
      blockIndex,
      confirmed: true,
      confirmedIssuanceUnits,
      directProofIssuanceUnits: 546,
      issuanceAccountingModel: INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      issuanceAmount: confirmedIssuanceUnits,
      issuanceCheckpointBlockHash: blockHash,
      issuanceCheckpointBlockHeight: blockHeight,
      issuanceCheckpointBlockIndex: blockIndex,
      issuanceCheckpointMode: "bond-transaction-provenance",
      issuanceValueSnapshotBlockHash: "f".repeat(64),
      issuanceValueSnapshotBlockHeight: blockHeight - 1,
      issuanceValueSnapshotCanonicalSummaryHash: "a".repeat(64),
      issuanceValueSnapshotGeneratedAt: "2026-07-13T03:13:00.000Z",
      issuanceValueSnapshotId: "snapshot-before-bond",
      issuanceValueSnapshotMode: "canonical-summary-refresh",
      issuanceValueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
      issuanceValueSnapshotWorkNetworkValueSats:
        String(
          (attachedWorkLiveValueAtSendSats / attachedWorkAmount) *
            WORK_TOKEN_MAX_SUPPLY,
        ),
      issuanceDustSats:
        issuanceNetworkValueSats - confirmedIssuanceUnits,
      issuanceFloorSats:
        issuanceNetworkValueSats / confirmedIssuanceUnits,
      issuanceNetworkValueSats,
      issuanceUnitSats: 1,
      issuanceValuationFixedAtSend: true,
      minterAddress: recipientAddress,
      paidSats: 546,
      proofPaymentSats: 546,
      sourceBondTxid: txid,
      ticker: "INCB",
      tokenId: INCB_TOKEN_ID,
      txid,
      validationMode: "canonical-incb-bond-projection",
    };
  };
  const canonicalMint = inceptionMint();
  assert.equal(
    inceptionIssuanceMetadataFromMints([
      {
        ...canonicalMint,
        issuanceValueSnapshotWorkNetworkValueSats: Number(
          canonicalMint.issuanceValueSnapshotWorkNetworkValueSats,
        ),
      },
    ]).complete,
    false,
    "legacy H-1 decimal aliases must remain strings until exact Q8 exists",
  );
  const legacyDdSnapshotSats = "8193547095.322113";
  const legacyDdAttachedSats = "1421798915.6275952";
  const legacyDdIssuanceSats = 546 + Number(legacyDdAttachedSats);
  const legacyDdConfirmedUnits = Math.floor(legacyDdIssuanceSats);
  const legacyDdMint = {
    ...canonicalMint,
    amount: String(legacyDdConfirmedUnits),
    attachedWorkAmount: "3644060",
    attachedWorkIssuanceUnits: "1421798915",
    attachedWorkLiveFloorAtSendSats:
      Number(legacyDdSnapshotSats) / WORK_TOKEN_MAX_SUPPLY,
    attachedWorkLiveValueAtSendSats: legacyDdAttachedSats,
    confirmedIssuanceUnits: String(legacyDdConfirmedUnits),
    issuanceAmount: String(legacyDdConfirmedUnits),
    issuanceDustSats:
      legacyDdIssuanceSats - legacyDdConfirmedUnits,
    issuanceFloorSats:
      legacyDdIssuanceSats / legacyDdConfirmedUnits,
    issuanceNetworkValueSats: String(legacyDdIssuanceSats),
    issuanceValueSnapshotWorkNetworkValueSats: legacyDdSnapshotSats,
  };
  const legacyDdIssuance = inceptionIssuanceMetadataFromMints([
    legacyDdMint,
  ]);
  assert.equal(legacyDdIssuance.complete, true);
  assert.equal(
    legacyDdIssuance.attachedWorkLiveValueAtSendQ8,
    "142179891562759519",
    "legacy dd743 derives attached value from the exact H-1 oracle and WORK atoms",
  );
  assert.equal(
    legacyDdIssuance.issuanceNetworkValueQ8,
    "142179946162759519",
  );
  assert.equal(legacyDdIssuance.issuanceDustQ8, "62759519");
  assert.equal(
    q8TextFromDecimal(legacyDdAttachedSats),
    "142179891562759520",
    "the stored legacy attached-value alias is intentionally one Q8 above the network-first result",
  );
  const transfer = {
    blockHash: "1".repeat(64),
    blockHeight: blockHeight + 1,
    blockIndex: 1,
    confirmed: true,
    createdAt: "2026-07-13T03:16:00.000Z",
    paidSats: 11,
    tokenId: INCB_TOKEN_ID,
    txid: "1".repeat(64),
  };
  const mutation = {
    amountSats: 7,
    blockHash: "2".repeat(64),
    blockHeight: blockHeight + 2,
    blockIndex: 1,
    confirmed: true,
    createdAt: "2026-07-13T03:17:00.000Z",
    kind: "token-listing",
    tokenId: INCB_TOKEN_ID,
    txid: "2".repeat(64),
  };
  const sale = {
    blockHash: "3".repeat(64),
    blockHeight: blockHeight + 3,
    blockIndex: 1,
    confirmed: true,
    createdAt: "2026-07-13T03:18:00.000Z",
    priceSats: 50,
    tokenId: INCB_TOKEN_ID,
    txid: "3".repeat(64),
  };
  const canonicalLedger = {
      activity: [bond, mutation],
      generatedAt: "2026-07-13T03:15:00.000Z",
      network: "livenet",
      tokenState: {
        confirmedSupply: 746,
        holders: [{ address: recipientAddress, balance: 746 }],
        invalidEvents: [],
        listings: [],
        mints: [canonicalMint],
        pendingSupply: 0,
        sales: [sale],
        source: "fixture",
        tokens: [
          {
            registryAddress: "bc1inceptionregistry",
            tokenId: INCB_TOKEN_ID,
          },
        ],
        transfers: [transfer],
      },
      workFloor: { liveFloorSats: 3 },
      workTokenState: {
        transfers: [
          {
            amount: 100,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditFloorAtConfirmSats: 2,
            creditLiveFloorSats: 99,
            creditLiveValueSats: 9_900,
            creditValueAtConfirmSats: 200,
            protocolVout: 3,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
          {
            amount: 25,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditFloorAtConfirmSats: 2,
            creditLiveFloorSats: 3,
            protocolVout: 4,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
          {
            amount: 100,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditFloorAtConfirmSats: 2,
            creditLiveFloorSats: 3,
            protocolVout: 5,
            recipientAddress: "bc1wrongrecipient",
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
        ],
      },
    };
  const summary = bondSummaryPayloadFromLedger(canonicalLedger, config);

  assert.equal(summary.actualValue.attachedWorkActions, 1);
  assert.equal(summary.actualValue.attachedWorkAmount, "100");
  assert.equal(summary.actualValue.attachedWorkFrozenValueSats, "200");
  assert.equal(summary.actualValue.attachedWorkLiveValueSats, "200");
  assert.equal(summary.actualValue.baseNetworkValueSats, "614");
  assert.equal(
    summary.actualValue.attachmentAccountingModel,
    INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
  );
  assert.equal(
    summary.actualValue.issuanceAccountingModel,
    INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
  );
  assert.equal(
    summary.actualValue.networkValueAccountingModel,
    INCEPTION_NETWORK_VALUE_ACCOUNTING_MODEL,
  );
  assert.equal(summary.actualValue.confirmedIssuanceUnits, "746");
  assert.equal(summary.actualValue.directProofIssuanceUnits, "546");
  assert.equal(summary.actualValue.attachedWorkIssuanceUnits, "200");
  assert.equal(summary.actualValue.issuanceNetworkValueSats, "746");
  assert.equal(summary.actualValue.issuanceFloorSats, "1");
  assert.equal(summary.actualValue.frozenNetworkValueSats, "814");
  assert.equal(summary.actualValue.liveNetworkValueSats, "814");
  assert.equal(summary.frozenNetworkValueSats, "814");
  assert.equal(summary.liveNetworkValueSats, "814");
  assert.equal(summary.networkValueSats, "814");
  assert.equal(summary.frozenFloorSats, "1.09115281");
  assert.equal(summary.liveFloorSats, "1.09115281");
  assert.equal(summary.chartPoints.length, 4);
  assert.equal(summary.chartPoints[0].networkValueSats, "746");
  assert.equal(summary.chartPoints[0].confirmedSupply, "746");
  assert.equal(summary.chartPoints[0].floorSats, "1");
  assert.equal(summary.chartPoints.at(-1).networkValueSats, "814");
  assert.equal(summary.chartPoints.at(-1).confirmedSupply, "746");

  const rejectedBondTxids = [
    "c9c9f4e382f598aa39b3be57adc8fe1defeb80e5216387d3af6b0948da232aff",
    "45b226453dde5b4d61a6a036af299d11ebfdeb65054bf26438ebc6ebebbf00c3",
    "e08080c1d86f0770dd6ebbabd98a9e066dc6043b548af7ecb7912fbbdfad4d50",
  ];
  const failedBondAttempts = rejectedBondTxids.map((failedBondTxid, index) => ({
    ...bond,
    amountSats: 1_000,
    attachedCredits: [
      {
        amount: 100_000 + index,
        protocolVout: 4,
        recipientAddress,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    blockHash: String(index + 6).repeat(64),
    blockHeight: 958_383 + index,
    blockIndex: 2_421 + index,
    createdAt: `2026-07-13T03:${18 + index}:30.000Z`,
    txid: failedBondTxid,
  }));
  const rejectedInceptionMints = rejectedBondTxids.map((failedBondTxid) => ({
    attemptedKind: "token-mint",
    confirmed: true,
    kind: "token-event-invalid",
    reasonCode: "reserved-bond-credit-namespace",
    sourceBondTxid: failedBondTxid,
    sourceKind: "inception-bond",
    tokenId: INCB_TOKEN_ID,
    txid: failedBondTxid,
    valid: false,
  }));
  const failedAttemptLedger = {
    ...canonicalLedger,
    activity: [...canonicalLedger.activity, ...failedBondAttempts],
    tokenState: {
      ...canonicalLedger.tokenState,
      invalidEvents: rejectedInceptionMints,
    },
  };
  const verifierBondActivity = inceptionVerifierBondActivity(
    failedAttemptLedger.activity,
    failedAttemptLedger.tokenState,
  );
  assert.ok(verifierBondActivity.includes(bond));
  assert.ok(verifierBondActivity.includes(mutation));
  assert.ok(
    failedBondAttempts.every(
      (attempt) => !verifierBondActivity.includes(attempt),
    ),
    "the ordered verifier must not resurrect explicitly rejected historical bonds",
  );
  const summaryWithFailedAttempt = bondSummaryPayloadFromLedger(
    failedAttemptLedger,
    config,
  );
  assert.equal(summaryWithFailedAttempt.stats.confirmedBondActions, 1);
  assert.equal(summaryWithFailedAttempt.actualValue.bondMintFlowSats, "546");
  assert.equal(summaryWithFailedAttempt.actualValue.baseNetworkValueSats, "614");
  assert.equal(
    summaryWithFailedAttempt.actualValue.attachedWorkActions,
    summary.actualValue.attachedWorkActions,
  );
  assert.equal(
    summaryWithFailedAttempt.actualValue.attachedWorkAmount,
    summary.actualValue.attachedWorkAmount,
  );
  assert.equal(
    summaryWithFailedAttempt.actualValue.attachedWorkFrozenValueSats,
    summary.actualValue.attachedWorkFrozenValueSats,
  );
  assert.equal(
    summaryWithFailedAttempt.actualValue.attachedWorkLiveValueSats,
    summary.actualValue.attachedWorkLiveValueSats,
  );
  assert.equal(
    summaryWithFailedAttempt.actualValue.attachedWorkUnmatchedActions,
    summary.actualValue.attachedWorkUnmatchedActions,
  );
  assert.equal(
    summaryWithFailedAttempt.actualValue.attachedWorkUnvaluedActions,
    0,
  );
  assert.equal(
    summaryWithFailedAttempt.stats.confirmedSupply,
    summary.stats.confirmedSupply,
  );
  assert.equal(summaryWithFailedAttempt.floorSats, summary.floorSats);
  assert.equal(summaryWithFailedAttempt.networkValueSats, "814");
  assert.deepEqual(summaryWithFailedAttempt.chartPoints, summary.chartPoints);
  assert.ok(
    failedBondAttempts.every((attempt) =>
      failedAttemptLedger.activity.includes(attempt),
    ) &&
      rejectedInceptionMints.every((event) =>
        failedAttemptLedger.tokenState.invalidEvents.includes(event),
      ),
    "summary filtering leaves Log and invalid-history source rows intact",
  );

  const unexplainedAttemptSummary = bondSummaryPayloadFromLedger(
    {
      ...failedAttemptLedger,
      tokenState: {
        ...failedAttemptLedger.tokenState,
        invalidEvents: [],
      },
    },
    config,
  );
  assert.equal(unexplainedAttemptSummary.stats.confirmedBondActions, 4);
  assert.equal(
    unexplainedAttemptSummary.actualValue.attachedWorkUnvaluedActions,
    3,
    "an unexplained missing mint remains fail-closed summary input",
  );

  const malformedMintSummary = bondSummaryPayloadFromLedger(
    {
      ...failedAttemptLedger,
      tokenState: {
        ...failedAttemptLedger.tokenState,
        mints: [
          ...failedAttemptLedger.tokenState.mints,
          {
            confirmed: true,
            tokenId: INCB_TOKEN_ID,
            txid: rejectedBondTxids[0],
          },
        ],
      },
    },
    config,
  );
  assert.equal(malformedMintSummary.stats.confirmedBondActions, 2);
  assert.equal(
    malformedMintSummary.actualValue.attachedWorkUnvaluedActions,
    1,
    "a malformed mint projection must fail closed even beside an invalid event",
  );

  const atomTxid = "4".repeat(64);
  const atomBlockHash = "5".repeat(64);
  const oneAtomMint = {
    ...inceptionMint({
      attachedWorkAmount: 1e-8,
      attachedWorkLiveValueAtSendSats: 1e-8,
    }),
    attachedWorkAmountAtoms: "1",
    attachedWorkLiveValueAtSendQ8: "1",
    blockHash: atomBlockHash,
    blockHeight: blockHeight + 4,
    blockIndex: 2,
    issuanceCheckpointBlockHash: atomBlockHash,
    issuanceCheckpointBlockHeight: blockHeight + 4,
    issuanceCheckpointBlockIndex: 2,
    issuanceDustQ8: "1",
    issuanceNetworkValueQ8: "54600000001",
    issuanceValueSnapshotBlockHeight: blockHeight + 3,
    issuanceValueSnapshotWorkNetworkValueQ8: "2100000000000000",
    sourceBondTxid: atomTxid,
    txid: atomTxid,
  };
  const productionTxid =
    "e1ecc4b4be95a6771801d516380eb20a0f8e3c0b2fb1045599a57d5a68fa1698";
  const productionBlockHash =
    "000000000000000000021fb7871138c76c262471fe3b178e8829d62cbf167ae8";
  const productionSnapshotNetworkValueQ8 = "61429267056874120000000";
  const productionAttachedValueQ8 = "11665710334419713836190";
  const productionIssuanceValueQ8 = "11665710334474313836190";
  const productionIssuanceUnits = 116_657_103_344_743;
  const productionIssuanceValue = q8ToNumber(
    productionIssuanceValueQ8,
  );
  const productionMint = {
    ...inceptionMint({
      attachedWorkAmount: 3_988_000,
      attachedWorkLiveValueAtSendSats: q8ToNumber(
        productionAttachedValueQ8,
      ),
    }),
    amount: productionIssuanceUnits,
    attachedWorkAmount: 3_988_000,
    attachedWorkAmountAtoms: "398800000000000",
    attachedWorkIssuanceUnits: 116_657_103_344_197,
    attachedWorkLiveFloorAtSendSats:
      614_292_670_568_741.2 / WORK_TOKEN_MAX_SUPPLY,
    attachedWorkLiveValueAtSendQ8: productionAttachedValueQ8,
    attachedWorkLiveValueAtSendSats: q8ToNumber(
      productionAttachedValueQ8,
    ),
    blockHash: productionBlockHash,
    blockHeight: 958_432,
    blockIndex: 1_653,
    confirmedIssuanceUnits: productionIssuanceUnits,
    issuanceAmount: productionIssuanceUnits,
    issuanceCheckpointBlockHash: productionBlockHash,
    issuanceCheckpointBlockHeight: 958_432,
    issuanceCheckpointBlockIndex: 1_653,
    issuanceDustQ8: "13836190",
    issuanceDustSats: 0.1383619,
    issuanceFloorSats:
      productionIssuanceValue / productionIssuanceUnits,
    issuanceNetworkValueQ8: productionIssuanceValueQ8,
    issuanceNetworkValueSats: productionIssuanceValue,
    issuanceValueSnapshotBlockHash:
      "0000000000000000000108134886191cca47cb3db5df607c7c5aa9a02e957b3f",
    issuanceValueSnapshotBlockHeight: 958_431,
    issuanceValueSnapshotCanonicalSummaryHash:
      "5b44677748e3a68e1ea376f8a2226277d9a53907279aff8ac4d2ba56524c6cfb",
    issuanceValueSnapshotGeneratedAt: "2026-07-17T21:12:25.822Z",
    issuanceValueSnapshotId: "ff4bf2984490c79d326866e3",
    issuanceValueSnapshotWorkNetworkValueQ8:
      productionSnapshotNetworkValueQ8,
    issuanceValueSnapshotWorkNetworkValueSats:
      614_292_670_568_741.2,
    sourceBondTxid: productionTxid,
    txid: productionTxid,
  };
  assert.ok(
    Math.abs(
      productionMint.issuanceFloorSats * productionIssuanceUnits -
        productionIssuanceValue,
    ) > 0.01,
    "the production-scale fixture must reproduce the unsafe float recomposition drift",
  );
  const productionIssuance = inceptionIssuanceMetadataFromMints([
    productionMint,
  ]);
  assert.equal(productionIssuance.complete, true);
  assert.equal(productionIssuance.canonicalMints, 1);
  assert.equal(
    inceptionIssuanceMetadataFromMints([
      { ...productionMint, issuanceNetworkValueQ8: "not-an-integer" },
    ]).complete,
    false,
    "present malformed exact Q8 metadata cannot fall back to a legacy decimal alias",
  );
  assert.equal(
    productionIssuance.confirmedIssuanceUnits,
    String(productionIssuanceUnits),
  );
  const overPrecisionLegacyMint = {
    ...canonicalMint,
    attachedWorkLiveFloorAtSendSats: "2.00000000001",
    attachedWorkLiveValueAtSendSats: "200.000000001",
    issuanceDustSats: "0.000000001",
    issuanceFloorSats: "1.00000000000134",
    issuanceNetworkValueSats: "746.000000001",
  };
  assert.equal(
    inceptionIssuanceMetadataFromMints([overPrecisionLegacyMint]).complete,
    true,
    "legacy derived-value aliases cannot override the exact H-1 oracle and WORK amount",
  );
  assert.equal(
    inceptionIssuanceMetadataFromMints([
      {
        ...overPrecisionLegacyMint,
        issuanceValueSnapshotWorkNetworkValueSats: "42000000.000000001",
      },
    ]).complete,
    false,
    "a legacy mint with an over-precision H-1 oracle must fail closed",
  );
  assert.equal(
    108_304_295_462_803n +
      BigInt(productionIssuance.confirmedIssuanceUnits),
    224_961_398_807_546n,
    "the valid production bond advances supply without the three rejected attempts",
  );
  assert.equal(
    233_298_041_090_722 -
      [
        2_925_137_643_008,
        3_363_908_289_591,
        2_047_596_350_577,
      ].reduce((total, amount) => total + amount, 0),
    224_961_398_807_546,
    "the three explicit invalid dispositions account for the resurrected verifier supply",
  );
  const oneAtomBond = {
    ...bond,
    attachedCredits: [
      {
        amount: 1e-8,
        amountAtoms: "1",
        protocolVout: 3,
        recipientAddress,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    blockHash: atomBlockHash,
    blockHeight: blockHeight + 4,
    blockIndex: 2,
    createdAt: "2026-07-13T03:19:00.000Z",
    txid: atomTxid,
  };
  const aggregateSummary = bondSummaryPayloadFromLedger(
    {
      activity: [bond, oneAtomBond],
      generatedAt: "2026-07-13T03:20:00.000Z",
      network: "livenet",
      tokenState: {
        confirmedSupply: 1_292,
        holders: [{ address: recipientAddress, balance: 1_292 }],
        listings: [],
        mints: [canonicalMint, oneAtomMint],
        pendingSupply: 0,
        sales: [],
        source: "fixture",
        tokens: [
          {
            registryAddress: "bc1inceptionregistry",
            tokenId: INCB_TOKEN_ID,
          },
        ],
        transfers: [],
      },
      workFloor: { liveFloorSats: 3 },
      workTokenState: {
        transfers: [
          {
            amount: 100,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditFloorAtConfirmSats: 2,
            protocolVout: 3,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
          {
            amount: 1e-8,
            amountAtoms: "1",
            blockHash: atomBlockHash,
            blockHeight: blockHeight + 4,
            blockIndex: 2,
            confirmed: true,
            creditFloorAtConfirmSats: 1,
            protocolVout: 3,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid: atomTxid,
            valid: true,
          },
        ],
      },
    },
    config,
  );
  assert.equal(
    aggregateSummary.actualValue.attachedWorkAmountAtoms,
    "10000000001",
    "public INCB actual value preserves a one-atom attachment in its aggregate",
  );

  const partial = bondAttachedWorkValueDetails(
    {
      tokenState: { mints: [canonicalMint] },
      workFloor: { liveFloorSats: 3 },
      workTokenState: {
        transfers: [
          {
            amount: 100,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditLiveValueSats: 300,
            creditValueAtConfirmSats: 200,
            protocolVout: 3,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
        ],
      },
    },
    [
      {
        ...bond,
        attachedCredits: [
          ...bond.attachedCredits,
          {
            amount: 999,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
          },
        ],
      },
    ],
    config,
  );
  assert.equal(partial.attachedWorkActions, 0);
  assert.equal(partial.attachedWorkUnvaluedActions, 2);
  assert.equal(
    partial.attachedWorkUnmatchedActions,
    1,
    "every declared WORK attachment must match one exact same-tx transfer",
  );

  const duplicateAttachments = bondAttachedWorkValueDetails(
    {
      tokenState: {
        mints: [
          inceptionMint({
            attachedWorkAmount: 200,
            attachedWorkLiveValueAtSendSats: 400,
          }),
        ],
      },
      workFloor: { liveFloorSats: 3 },
      workTokenState: {
        transfers: [2, 3].map((protocolVout, index) => ({
          _powEventIndex: index + 10,
          amount: 100,
          blockHash,
          blockHeight,
          blockIndex,
          confirmed: true,
          creditLiveValueSats: 300,
          creditValueAtConfirmSats: 200,
          protocolVout,
          recipientAddress,
          tokenId: WORK_TOKEN_ID,
          txid,
          valid: true,
        })),
      },
    },
    [
      {
        ...bond,
        attachedCredits: [2, 3].map((protocolVout) => ({
          amount: 100,
          protocolVout,
          recipientAddress,
          tokenId: WORK_TOKEN_ID,
        })),
      },
    ],
    config,
  );
  assert.equal(duplicateAttachments.attachedWorkActions, 2);
  assert.equal(duplicateAttachments.attachedWorkAmount, "200");
  assert.equal(duplicateAttachments.attachedWorkFrozenValueSats, "400");
  assert.equal(duplicateAttachments.attachedWorkLiveValueSats, "400");
  assert.equal(duplicateAttachments.attachedWorkUnmatchedActions, 0);
  assert.equal(duplicateAttachments.attachedWorkUnvaluedActions, 0);

  const readerIdentityDetails = isolatedFunction(
    READER_PATH,
    "canonicalEventIdentityDetails",
  );
  const rowNumber = (row, key) => {
    const number = Number(row?.[key]);
    return Number.isFinite(number) ? number : 0;
  };
  const tokenTransferFromEventPayload = isolatedFunction(
    READER_PATH,
    "tokenTransferFromEventPayload",
    {
      canonicalEventIdentityDetails: readerIdentityDetails,
      dateIso: (value) => value,
      isWorkTokenId: (value) => value === WORK_TOKEN_ID,
      rowNumber,
      tokenRegistryAddressFromPayload: () => "bc1workregistry",
      tokenTransferAmountFromTags: () => 0,
    },
  );
  const apiIdentityDetails = isolatedFunction(
    API_PATH,
    "canonicalEventIdentityDetails",
  );
  const tokenTransferFromIndexedActivityItem = isolatedFunction(
    API_PATH,
    "tokenTransferFromIndexedActivityItem",
    {
      WORK_TOKEN_ID,
      canonicalEventIdentityDetails: apiIdentityDetails,
      canonicalMinerFeeDetailsFromActivity: () => ({}),
      creditAmountFromActivityItem: (item) => numericValue(item?.amount),
      indexedActivityValue: (item, ...keys) =>
        keys.map((key) => item?.[key]).find(Boolean) ?? "",
      isWorkTokenId: (value) => value === WORK_TOKEN_ID,
      numericValue,
      tokenLedgerAmountFields: testTokenLedgerAmountFields,
      tokenLedgerAmountFromRecord: (_tokenId, record) =>
        workAtomsBigIntFromRecord(record),
    },
  );
  const mailAttachedCreditsFromRecord = isolatedFunction(
    API_PATH,
    "mailAttachedCreditsFromRecord",
    {
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: "bc1workregistry",
      WORK_TOKEN_ID,
      WORK_TOKEN_TICKER: "WORK",
      canonicalEventIdentityDetails: apiIdentityDetails,
      isValidBitcoinAddress: () => true,
      normalizeTokenTicker: (value) => String(value).trim().toUpperCase(),
      numericValue,
      tokenLedgerAmountFields: testTokenLedgerAmountFields,
    },
  );
  const pipelineTransfers = [2, 3].map((protocolVout, index) => {
    const readerTransfer = tokenTransferFromEventPayload(
      {
        _powEventIndex: index + 20,
        amount: 100,
        creditLiveValueSats: 300,
        creditValueAtConfirmSats: 200,
        eventKeyVout: index,
        protocolVout,
        recipientAddress,
        senderAddress: "bc1sender",
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
        txid,
      },
      { event_id: index + 100, network: "livenet", status: "confirmed" },
    );
    return tokenTransferFromIndexedActivityItem(
      readerTransfer,
      {
        registryAddress: "bc1workregistry",
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
      "livenet",
    );
  });
  const pipelineAttachedCredits = mailAttachedCreditsFromRecord(
    {
      attachedCredits: [2, 3].map((protocolVout, index) => ({
        _powEventIndex: index + 30,
        amount: 100,
        protocolVout,
        recipientAddress,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      })),
    },
    "livenet",
  );
  assert.deepEqual(
    pipelineTransfers.map((transfer) => [
      transfer?.amount,
      transfer?.amountAtoms,
    ]),
    [
      [100, "10000000000"],
      [100, "10000000000"],
    ],
  );
  assert.deepEqual(
    pipelineAttachedCredits.map((credit) => [
      credit?.amount,
      credit?.amountAtoms,
    ]),
    [
      [100, "10000000000"],
      [100, "10000000000"],
    ],
  );
  assert.deepEqual(
    pipelineTransfers.map((transfer) => [
      transfer?._powEventIndex,
      transfer?.eventKeyVout,
      transfer?.protocolVout,
      transfer?.eventId,
    ]),
    [
      [20, 0, 2, 100],
      [21, 1, 3, 101],
    ],
  );
  assert.deepEqual(
    pipelineAttachedCredits.map((credit) => credit.protocolVout),
    [2, 3],
  );
  const tokenTransferHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenTransferHistoryItemKey",
    { numericValue },
  );
  const tokenMintHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenMintHistoryItemKey",
    { numericValue },
  );
  const tokenValueStateSource = topLevelFunctionSource(
    API_PATH,
    "tokenValueStateFromIndexedActivity",
  );
  assert.match(
    tokenValueStateSource,
    /mints\.push\(\{\s*\.\.\.canonicalEventIdentityDetails\(item\),/u,
    "activity-derived mints must preserve the canonical event identity used by token-table mints",
  );
  assert.match(
    tokenValueStateSource,
    /item\?\.amount\s*\?\?\s*item\?\.tokenAmount\s*\?\?\s*item\?\.creditAmountMoved\s*\?\?\s*fallbackAmount/u,
    "activity-derived listings must prefer their exact amount field over the approximate prose fallback",
  );
  const tokenHistoryPageItemKey = isolatedFunction(
    API_PATH,
    "tokenHistoryPageItemKey",
    { tokenMintHistoryItemKey, tokenTransferHistoryItemKey },
  );
  assert.equal(
    new Set(
      pipelineTransfers.map((transfer) =>
        tokenHistoryPageItemKey(transfer, "transfers"),
      ),
    ).size,
    2,
  );
  const mergeTokenStateItemsByKey = isolatedFunction(
    API_PATH,
    "mergeTokenStateItemsByKey",
    { compareTokenHistoryPageItems: () => 0 },
  );
  const mintTxid = "9".repeat(64);
  const indexedMint = {
    _powEventIndex: 7,
    amount: 100,
    minterAddress: "bc1minter",
    tokenId: WORK_TOKEN_ID,
    txid: mintTxid,
  };
  const reconstructedMint = {
    ...apiIdentityDetails(indexedMint),
    amount: indexedMint.amount,
    minterAddress: indexedMint.minterAddress,
    tokenId: indexedMint.tokenId,
    txid: indexedMint.txid,
  };
  assert.equal(
    mergeTokenStateItemsByKey(
      [indexedMint],
      [reconstructedMint],
      tokenMintHistoryItemKey,
    ).length,
    1,
    "the activity and exact token-table views of one mint must merge once",
  );
  const tokenStateWithScopedTokenOverride = isolatedFunction(
    API_PATH,
    "tokenStateWithScopedTokenOverride",
    {
      mergeTokenListingRecord: (current, incoming) => current ?? incoming,
      mergeTokenStateItemsByKey,
      mergeTokenTransferRecord: (current, incoming) => current ?? incoming,
      tokenClosedListingItemKey: (item) => item?.listingId ?? "",
      tokenListingItemKey: (item) => item?.listingId ?? "",
      tokenMintHistoryItemKey,
      tokenSaleItemKey: (item) => item?.txid ?? "",
      tokenStateWithPendingStats: (state) => state,
      tokenTransferHistoryItemKey,
    },
  );
  const scopedPipelineState = tokenStateWithScopedTokenOverride(
    { tokens: [], transfers: [] },
    {
      tokens: [{ ticker: "WORK", tokenId: WORK_TOKEN_ID }],
      transfers: pipelineTransfers,
    },
    WORK_TOKEN_ID,
  );
  assert.equal(scopedPipelineState.transfers.length, 2);
  const normalizedPipelineAttachments = bondAttachedWorkValueDetails(
    {
      tokenState: {
        mints: [
          inceptionMint({
            attachedWorkAmount: 200,
            attachedWorkLiveValueAtSendSats: 400,
          }),
        ],
      },
      workFloor: { liveFloorSats: 3 },
      workTokenState: { transfers: scopedPipelineState.transfers },
    },
    [{ ...bond, attachedCredits: pipelineAttachedCredits }],
    config,
  );
  assert.equal(normalizedPipelineAttachments.attachedWorkActions, 2);
  assert.equal(normalizedPipelineAttachments.attachedWorkAmount, "200");
  assert.equal(normalizedPipelineAttachments.attachedWorkUnmatchedActions, 0);
  assert.equal(normalizedPipelineAttachments.attachedWorkUnvaluedActions, 0);
});

check("Inception issuance floors the pre-bond live WORK network value once", () => {
  const INCB_TOKEN_ID = "incb";
  const INCEPTION_ISSUANCE_ACCOUNTING_MODEL =
    "canonical-pre-bond-live-network-value-v2";
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const WORK_TOKEN_ID = "work";
  const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
  const txid =
    "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4";
  const blockHash =
    "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5";
  const blockHeight = 957_950;
  const blockIndex = 382;
  const recipientAddress = "bc1inceptiontarget";
  const numericValue = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const samePaymentAddress = (left, right) =>
    String(left).toLowerCase() === String(right).toLowerCase();
  const ledgerTokenStateForScope = (ledger, tokenId) =>
    tokenId === WORK_TOKEN_ID ? ledger.workTokenState : ledger.tokenState;
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID,
      canonicalEventOrdinal,
      ledgerTokenStateForScope,
      numericValue,
      samePaymentAddress,
    },
  );
  const inceptionIssuanceCheckpoint = isolatedFunction(
    API_PATH,
    "inceptionIssuanceCheckpoint",
    {
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      inceptionPreBondLiveNetworkValueSats: () => 0,
      numericValue,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      Map,
      WORK_TOKEN_MAX_SUPPLY,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      canonicalEventOrdinal,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      numericValue,
      samePaymentAddress,
    },
  );
  const bond = {
    amountSats: 546,
    attachedCredits: [
      {
        amount: 3_644_060,
        protocolVout: 3,
        recipientAddress,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    confirmed: true,
    blockHash,
    blockHeight,
    blockIndex,
    createdAt: "2026-07-14T03:09:35.000Z",
    kind: "inception-bond",
    recipients: [{ address: recipientAddress, amountSats: 546 }],
    txid,
  };
  const preBondWorkNetworkValueQ8 = q8TextFromDecimal(
    "8193547095.32211304",
  );
  const preBondWorkNetworkValueSats = decimalTextFromQ8(
    preBondWorkNetworkValueQ8,
  );
  const workFloorAtSend = Number(
    decimalTextFromQ8(
      BigInt(preBondWorkNetworkValueQ8) /
        BigInt(WORK_TOKEN_MAX_SUPPLY),
    ),
  );
  const publishedCheckpoint = {
    blockHash,
    blockHeight,
    blockIndex,
    valueSnapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    valueSnapshotBlockHeight: blockHeight - 1,
    valueSnapshotCanonicalSummaryHash:
      "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc",
    valueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
    valueSnapshotId: "b8e77cd30cbed6855977c514",
    valueSnapshotMode: "canonical-summary-refresh",
    valueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
    workNetworkValueQ8: preBondWorkNetworkValueQ8,
    workNetworkValueSats: preBondWorkNetworkValueSats,
  };
  const sourceMint = {
    amount: 546,
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt: bond.createdAt,
    minterAddress: recipientAddress,
    paidSats: 546,
    tokenId: INCB_TOKEN_ID,
    txid,
  };
  const sourceTransfer = {
    amount: 3_644_060,
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    protocolVout: 3,
    recipientAddress,
    tokenId: WORK_TOKEN_ID,
    txid,
    valid: true,
  };
  const [mint] = inceptionMintsWithLiveIssuance(
    [sourceMint],
    [bond],
    {
      activity: [bond],
      tokenState: {},
      workTokenState: {
        transfers: [sourceTransfer],
      },
    },
    {
      preBondCheckpoint: () => publishedCheckpoint,
    },
  );
  const exactIssuanceQ8 =
    546n * VALUE_Q8_SCALE +
    (3_644_060n * BigInt(preBondWorkNetworkValueQ8)) /
      BigInt(WORK_TOKEN_MAX_SUPPLY);
  const exactIssuance = Number(decimalTextFromQ8(exactIssuanceQ8));

  assert.equal(mint.amount, "1421799461");
  assert.equal(mint.issuanceAmount, "1421799461");
  assert.equal(mint.confirmedIssuanceUnits, "1421799461");
  assert.equal(mint.directProofIssuanceUnits, "546");
  assert.equal(mint.attachedWorkAmount, "3644060");
  assert.equal(mint.attachedWorkIssuanceUnits, "1421798915");
  assert.ok(
    Math.abs(Number(mint.attachedWorkLiveFloorAtSendSats) - workFloorAtSend) <
      1e-8,
  );
  assert.ok(
    Math.abs(
      Number(mint.attachedWorkLiveValueAtSendSats) - 1_421_798_915.6275952,
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(Number(mint.issuanceNetworkValueSats) - exactIssuance) < 1e-6,
  );
  assert.ok(
    Math.abs(
      Number(mint.issuanceDustSats) -
        (exactIssuance - Math.floor(exactIssuance)),
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(
      Number(mint.issuanceFloorSats) -
        exactIssuance / Math.floor(exactIssuance),
    ) < 1e-8,
  );
  assert.equal(
    mint.issuanceAccountingModel,
    INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
  );
  assert.equal(
    mint.issuanceCheckpointMode,
    "bond-transaction-provenance",
  );
  assert.equal(mint.issuanceValuationFixedAtSend, true);
  assert.equal(mint.issuanceUnitSats, 1);
  assert.equal(mint.amountSats, 0);
  assert.equal(mint.bondRecipientAddress, recipientAddress);
  assert.equal(mint.bondRecipientAmountSats, 546);
  assert.equal(mint.bondRecipientVout, 0);
  assert.equal(mint.proofPaymentSats, 546);
  assert.equal(mint.sourceBondTxid, txid);
  assert.equal(mint.validationMode, "canonical-incb-bond-projection");
  assert.equal(mint.issuanceCheckpointBlockHeight, blockHeight);
  assert.equal(mint.issuanceCheckpointBlockHash, blockHash);
  assert.equal(mint.issuanceCheckpointBlockIndex, blockIndex);
  assert.equal(
    mint.issuanceValueSnapshotWorkNetworkValueSats,
    "8193547095.32211304",
  );
  assert.equal(
    mint.issuanceValueSnapshotBlockHash,
    "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
  );
  assert.equal(mint.issuanceValueSnapshotBlockHeight, blockHeight - 1);
  assert.equal(
    mint.issuanceValueSnapshotCanonicalSummaryHash,
    "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc",
  );
  assert.equal(
    mint.issuanceValueSnapshotGeneratedAt,
    "2026-07-14T03:03:04.765Z",
  );
  assert.equal(mint.issuanceValueSnapshotId, "b8e77cd30cbed6855977c514");
  assert.equal(mint.issuanceValueSnapshotMode, "canonical-summary-refresh");
  assert.equal(
    mint.issuanceValueSnapshotModel,
    INCEPTION_VALUE_SNAPSHOT_MODEL,
  );

  const inceptionMintHasCanonicalBondBinding = isolatedFunction(
    API_PATH,
    "inceptionMintHasCanonicalBondBinding",
    {
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      canonicalEventOrdinal,
      inceptionIssuanceMetadataFromMints: () => ({ complete: true }),
      numericValue,
      samePaymentAddress,
    },
  );
  const immutableIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      Map,
      WORK_TOKEN_MAX_SUPPLY,
      canonicalEventOrdinal,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      inceptionMintHasCanonicalBondBinding,
      isInceptionBondActivityItem: (item) => item?.kind === "inception-bond",
      numbersAgree: (left, right, tolerance = 0) =>
        Math.abs(Number(left) - Number(right)) <= tolerance,
      numericValue,
      samePaymentAddress,
    },
  );
  assert.strictEqual(
    immutableIssuance([mint], [bond], {
      tokenState: {},
      workTokenState: { transfers: [sourceTransfer] },
    }, {
      preBondCheckpoint: () => publishedCheckpoint,
    })[0],
    mint,
    "a complete bound v2 mint must never be repriced",
  );
  const [oracleMismatch] = immutableIssuance(
    [mint],
    [bond],
    {
      network: "livenet",
      tokenState: {},
      workTokenState: { transfers: [sourceTransfer] },
    },
    {
      preBondCheckpoint: () => ({
        ...publishedCheckpoint,
        workNetworkValueQ8: (
          BigInt(preBondWorkNetworkValueQ8) * 10n
        ).toString(),
        workNetworkValueSats: decimalTextFromQ8(
          BigInt(preBondWorkNetworkValueQ8) * 10n,
        ),
      }),
    },
  );
  assert.equal(oracleMismatch.issuanceValueSnapshotModel, "");
  assert.equal(
    oracleMismatch.validationMode,
    "canonical-incb-value-snapshot-mismatch",
  );

  const [unproven] = inceptionMintsWithLiveIssuance(
    [{ ...sourceMint, blockHash: "" }],
    [bond],
    {
      activity: [bond],
      tokenState: {},
      workTokenState: { transfers: [sourceTransfer] },
    },
    {
      preBondCheckpoint: () => publishedCheckpoint,
    },
  );
  assert.equal(unproven.amount, 546);
  assert.equal(unproven.issuanceAccountingModel, undefined);
});

check("pre-bond live value uses canonical position without timestamp override", () => {
  const blockHash = "a".repeat(64);
  const bondTxid = "b".repeat(64);
  const canonicalItemPrecedesBondTransaction = isolatedFunction(
    API_PATH,
    "canonicalItemPrecedesBondTransaction",
  );
  const inceptionPreBondLiveNetworkValueQ8 = isolatedFunction(
    API_PATH,
    "inceptionPreBondLiveNetworkValueQ8",
    {
      canonicalItemPrecedesBondTransaction,
      growthActualNetworkValue: (...collections) => ({
        liveNetworkValueQ8: q8TextFromDecimal(
          collections
            .slice(0, 7)
            .flat()
            .reduce((total, item) => total + item.value, 0),
        ),
      }),
    },
  );
  const inceptionPreBondLiveNetworkValueSats = isolatedFunction(
    API_PATH,
    "inceptionPreBondLiveNetworkValueSats",
    {
      inceptionPreBondLiveNetworkValueQ8,
    },
  );
  const bond = {
    blockHash,
    blockHeight: 100,
    blockIndex: 5,
    confirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    network: "livenet",
    txid: bondTxid,
  };
  const item = (value, overrides = {}) => ({
    blockHash,
    blockHeight: 100,
    blockIndex: 4,
    confirmed: true,
    createdAt: "2030-01-01T00:00:00.000Z",
    network: "livenet",
    txid: String(value).padStart(64, "0"),
    value,
    ...overrides,
  });
  const ledger = {
    activity: [
      item(2, { blockHeight: 99, blockIndex: 999 }),
      item(100, { blockIndex: 6 }),
      item(200, { txid: bondTxid, blockIndex: 1 }),
      item(400, {
        blockHash: undefined,
        blockHeight: undefined,
        blockIndex: undefined,
        createdAt: "1990-01-01T00:00:00.000Z",
      }),
      item(800, { blockHash: "c".repeat(64), blockIndex: 3 }),
    ],
    registryState: {
      records: [item(1)],
      sales: [item(4)],
    },
    tokenState: {
      mints: [item(16)],
      sales: [item(64)],
      tokens: [item(8)],
      transfers: [item(32)],
    },
  };
  assert.equal(
    inceptionPreBondLiveNetworkValueSats(ledger, bond),
    "2",
    "a positioned livenet fallback is H-1 and excludes the whole bond block",
  );
  assert.equal(
    canonicalItemPrecedesBondTransaction(
      item(1, { blockIndex: 3, createdAt: "2035-01-01T00:00:00.000Z" }),
      bond,
    ),
    true,
    "same-block earlier index wins even when timestamps regress",
  );

  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const samePaymentAddress = (left, right) =>
    String(left).toLowerCase() === String(right).toLowerCase();
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID: "work",
      canonicalEventOrdinal,
      ledgerTokenStateForScope: (state, scope) =>
        scope === "work" ? state.workTokenState : state.tokenState,
      numericValue: (value) => Number(value) || 0,
      samePaymentAddress,
    },
  );
  const inceptionIssuanceCheckpoint = isolatedFunction(
    API_PATH,
    "inceptionIssuanceCheckpoint",
    {
      inceptionPreBondLiveNetworkValueSats,
      numericValue: (value) => Number(value) || 0,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID: "incb",
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      Map,
      WORK_TOKEN_MAX_SUPPLY: 1,
      canonicalEventOrdinal,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      isInceptionBondActivityItem: (candidate) =>
        candidate?.kind === "inception-bond",
      numericValue: (value) => Number(value) || 0,
      samePaymentAddress,
    },
  );
  const recipientAddress = "recipient";
  const positionedBond = {
    ...bond,
    amountSats: 546,
    attachedCredits: [{
      amount: 2,
      protocolVout: 3,
      recipientAddress,
      tokenId: "work",
    }],
    kind: "inception-bond",
    recipients: [{ address: recipientAddress, amountSats: 546, vout: 0 }],
  };
  const [issued] = inceptionMintsWithLiveIssuance(
    [{
      amount: 546,
      blockHash,
      blockHeight: 100,
      blockIndex: 5,
      confirmed: true,
      minterAddress: recipientAddress,
      paidSats: 546,
      tokenId: "incb",
      txid: bondTxid,
    }],
    [positionedBond],
    {
      ...ledger,
      workTokenState: {
        transfers: [{
          amount: 2,
          blockHash,
          blockHeight: 100,
          blockIndex: 5,
          confirmed: true,
          protocolVout: 3,
          recipientAddress,
          tokenId: "work",
          txid: bondTxid,
          valid: true,
        }],
      },
    },
  );
  assert.equal(issued.amount, 546);
  assert.equal(issued.issuanceAccountingModel, undefined);
  const creditValueEventHeight = isolatedFunction(
    API_PATH,
    "creditValueEventHeight",
  );
  const creditValueEventIndex = isolatedFunction(
    API_PATH,
    "creditValueEventIndex",
  );
  const compareCreditValueReplayEvents = isolatedFunction(
    API_PATH,
    "compareCreditValueReplayEvents",
    {
      canonicalTokenReplayOrdinal: () => Number.MAX_SAFE_INTEGER,
      creditValueEventHeight,
      creditValueEventIndex,
    },
  );
  assert.ok(
    compareCreditValueReplayEvents(
      {
        createdMs: Date.parse("2030-01-01T00:00:00.000Z"),
        order: 0,
        source: { blockHeight: 100, blockIndex: 4 },
        txid: "a",
      },
      {
        createdMs: Date.parse("1990-01-01T00:00:00.000Z"),
        order: 0,
        source: { blockHeight: 100, blockIndex: 6 },
        txid: "b",
      },
    ) < 0,
    "credit valuation replay must ignore regressing block timestamps",
  );
  const growthActualBaseNetworkValueBeforeCanonicalItem = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueBeforeCanonicalItem",
    {
      canonicalItemPrecedesBondTransaction,
      growthActualBaseNetworkValue: (...args) => ({
        totalSats: args.slice(0, 7).flat().reduce(
          (total, candidate) => total + candidate.value,
          0,
        ),
      }),
      numericValue: (value) => Number(value) || 0,
    },
  );
  assert.equal(
    growthActualBaseNetworkValueBeforeCanonicalItem(
      bond,
      {
        idActivity: [
          item(3, {
            blockIndex: 4,
            createdAt: "2030-01-01T00:00:00.000Z",
          }),
          item(99, {
            blockIndex: 6,
            createdAt: "1990-01-01T00:00:00.000Z",
          }),
        ],
        records: [],
        sales: [],
        tokenDefinitions: [],
        tokenMints: [],
        tokenSales: [],
        tokenTransfers: [],
      },
      Date.parse(bond.createdAt),
      () => 999,
    ),
    3,
    "base-before must follow canonical position rather than block time",
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const regressingTimeline = canonicalReplayTimeline([
    { createdMs: 200 },
    { createdMs: 100 },
  ]);
  assert.equal(
    canonicalReplayPrefixLengthAtMs(regressingTimeline, 150),
    2,
    "a later canonical event with an earlier block time implies its full chain prefix",
  );
});

check("livenet Inception issuance uses the published H-1 snapshot and excludes its whole block", () => {
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const canonicalItemPrecedesBondTransaction = isolatedFunction(
    API_PATH,
    "canonicalItemPrecedesBondTransaction",
  );
  const canonicalTokenReplayOrdinal = isolatedFunction(
    API_PATH,
    "canonicalTokenReplayOrdinal",
  );
  const creditValueEventHeight = isolatedFunction(
    API_PATH,
    "creditValueEventHeight",
  );
  const creditValueEventIndex = isolatedFunction(
    API_PATH,
    "creditValueEventIndex",
  );
  const creditValueEventMs = isolatedFunction(
    API_PATH,
    "creditValueEventMs",
  );
  const compareCreditValueReplayEvents = isolatedFunction(
    API_PATH,
    "compareCreditValueReplayEvents",
    {
      canonicalTokenReplayOrdinal,
      creditValueEventHeight,
      creditValueEventIndex,
    },
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const baseGlobals = {
    BOND_TOKEN_IDS: new Set(["incb", "powb"]),
    GROWTH_MODEL_INPUTS: {
      idDensitySatsPerN2: 0,
      valueMultiple: 1,
    },
    GROWTH_MODEL_START_MS: 0,
    ID_MARKETPLACE_MUTATION_KINDS: new Set(),
    MS_PER_MODEL_YEAR: 1,
    TOKEN_MARKETPLACE_MUTATION_KINDS: new Set(),
    activityAmountSats: (item) => numericValue(item?.amountSats),
    activityKindHasDedicatedGrowthBucket: () => true,
    confirmedActivityFlowSats: () => 0,
    growthSatsToUsdAtYears: () => 0,
    isBondActivityItem: () => false,
    isBrowserActivityItem: () => false,
    isInceptionBondActivityItem: () => false,
    isInfinityBondActivityItem: () => false,
    numericValue,
    publicMarketplaceSales: (items) => items,
    unbucketedConfirmedComputerLogFlowSats: () => 0,
  };
  const emptyGrowthActualBaseState = isolatedFunction(
    API_PATH,
    "emptyGrowthActualBaseState",
  );
  const growthActualBaseStateApplyContribution = isolatedFunction(
    API_PATH,
    "growthActualBaseStateApplyContribution",
    { numericValue },
  );
  const growthActualBaseStateAdd = isolatedFunction(
    API_PATH,
    "growthActualBaseStateAdd",
    { numericValue },
  );
  const growthActualBaseStateTotalQ8 = isolatedFunction(
    API_PATH,
    "growthActualBaseStateTotalQ8",
  );
  const growthActualBaseStateTotalSats = isolatedFunction(
    API_PATH,
    "growthActualBaseStateTotalSats",
    { growthActualBaseStateTotalQ8 },
  );
  const growthActualBaseNetworkValue = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValue",
    {
      ...baseGlobals,
      growthActualBaseStateTotalQ8,
    },
  );
  const growthActualBaseNetworkValueEvents = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueEvents",
    baseGlobals,
  );
  const growthActualBaseNetworkValueAtProvider = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueAtProvider",
    {
      emptyGrowthActualBaseState,
      growthActualBaseNetworkValueEvents,
      growthActualBaseStateApplyContribution,
      growthActualBaseStateTotalQ8,
      growthActualBaseStateTotalSats,
    },
  );
  const growthActualBaseNetworkValueBeforeCanonicalItem = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueBeforeCanonicalItem",
    {
      canonicalItemPrecedesBondTransaction,
      growthActualBaseNetworkValue,
      numericValue,
    },
  );
  const growthActualBaseNetworkValueBeforeCanonicalItemProvider =
    isolatedFunction(
      API_PATH,
      "growthActualBaseNetworkValueBeforeCanonicalItemProvider",
      {
        emptyGrowthActualBaseState,
        growthActualBaseNetworkValueEvents,
        growthActualBaseStateAdd,
        growthActualBaseStateApplyContribution,
        growthActualBaseStateTotalQ8,
        growthActualBaseStateTotalSats,
        numericValue,
      },
    );
  const tokenCanUseCreditNetworkFloor = isolatedFunction(
    API_PATH,
    "tokenCanUseCreditNetworkFloor",
    { WORK_TOKEN_ID: "work" },
  );
  const growthActualLiveTotalSatsAtProvider = isolatedFunction(
    API_PATH,
    "growthActualLiveTotalSatsAtProvider",
    {
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
      canonicalReplayPrefixLengthAtMs,
      canonicalReplayTimeline,
      compareCreditValueReplayEvents,
      creditReplayTransactionMinerFeeSats,
      creditValueEventHeight,
      creditValueEventIndex,
      creditValueEventMs,
      growthActualBaseNetworkValueAtProvider,
      growthActualBaseNetworkValueBeforeCanonicalItemProvider,
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor,
    },
  );
  const inceptionPreBondLiveNetworkValueQ8 = isolatedFunction(
    API_PATH,
    "inceptionPreBondLiveNetworkValueQ8",
    {
      canonicalItemPrecedesBondTransaction,
      growthActualNetworkValue: (...collections) => {
        const at = growthActualLiveTotalSatsAtProvider(
          ...collections.slice(0, 7),
        );
        return {
          liveNetworkValueQ8: q8TextFromDecimal(
            at(Number.MAX_SAFE_INTEGER),
          ),
        };
      },
    },
  );
  const inceptionPreBondLiveNetworkValueSats = isolatedFunction(
    API_PATH,
    "inceptionPreBondLiveNetworkValueSats",
    {
      inceptionPreBondLiveNetworkValueQ8,
    },
  );
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID: "work",
      canonicalEventOrdinal,
      ledgerTokenStateForScope: (state, scope) =>
        scope === "work" ? state.workTokenState : state.tokenState,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const inceptionIssuanceCheckpoint = isolatedFunction(
    API_PATH,
    "inceptionIssuanceCheckpoint",
    {
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      inceptionPreBondLiveNetworkValueSats,
      numericValue,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID: "incb",
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      WORK_TOKEN_MAX_SUPPLY: 1_000,
      canonicalEventOrdinal,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
      workAtomsValueAtNetworkQ8: (amountAtoms, networkValue) =>
        (BigInt(amountAtoms) * BigInt(q8TextFromDecimal(networkValue))) /
        (1_000n * WORK_UNIT_SCALE),
    },
  );

  const blockHash = "d".repeat(64);
  const bondTxid = "e".repeat(64);
  const recipientAddress = "recipient";
  const positioned = (txid, blockHeight, blockIndex, createdAt, extra = {}) => ({
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt,
    network: "livenet",
    txid,
    ...extra,
  });
  const workDefinition = positioned(
    "1".repeat(64),
    99,
    1,
    "2035-01-01T00:00:00.000Z",
    {
      creationFeeSats: 1_000,
      maxSupply: 1_000,
      ticker: "WORK",
      tokenId: "work",
    },
  );
  const priorWorkMint = positioned(
    "2".repeat(64),
    100,
    4,
    "2036-01-01T00:00:00.000Z",
    {
      amount: 100,
      paidSats: 0,
      tokenId: "work",
    },
  );
  const bond = positioned(
    bondTxid,
    100,
    5,
    "2026-01-01T00:00:00.000Z",
    {
      amountSats: 546,
      attachedCredits: [{
        amount: 10,
        protocolVout: 3,
        recipientAddress,
        tokenId: "work",
      }],
      kind: "inception-bond",
      recipients: [{ address: recipientAddress, amountSats: 546, vout: 0 }],
    },
  );
  const attachment = positioned(
    bondTxid,
    100,
    5,
    "2026-01-01T00:00:00.000Z",
    {
      amount: 10,
      protocolVout: 3,
      recipientAddress,
      tokenId: "work",
      valid: true,
    },
  );
  const postBondMint = positioned(
    "3".repeat(64),
    100,
    6,
    "1990-01-01T00:00:00.000Z",
    {
      amount: 900_000,
      paidSats: 900_000,
      tokenId: "work",
    },
  );
  const unknownPositionMint = {
    amount: 900_000,
    confirmed: true,
    createdAt: "1980-01-01T00:00:00.000Z",
    network: "livenet",
    paidSats: 900_000,
    tokenId: "work",
    txid: "4".repeat(64),
  };
  const seedMint = positioned(
    bondTxid,
    100,
    5,
    "2026-01-01T00:00:00.000Z",
    {
      amount: 546,
      minterAddress: recipientAddress,
      paidSats: 546,
      tokenId: "incb",
    },
  );
  const ledger = {
    activity: [bond],
    registryState: { records: [], sales: [] },
    tokenState: {
      mints: [
        priorWorkMint,
        attachment,
        postBondMint,
        unknownPositionMint,
      ],
      sales: [],
      tokens: [workDefinition],
      transfers: [attachment],
    },
    workTokenState: { transfers: [attachment] },
  };

  assert.equal(
    inceptionPreBondLiveNetworkValueSats(ledger, bond),
    "5000",
    "the exact H-1 fallback excludes the whole bond block and retains only prior-block value",
  );
  const [unproven] = inceptionMintsWithLiveIssuance(
    [seedMint],
    [bond],
    ledger,
  );
  assert.equal(unproven.amount, 546);
  assert.equal(unproven.issuanceAccountingModel, undefined);

  const publishedCheckpoint = {
    blockHash,
    blockHeight: 100,
    blockIndex: 5,
    valueSnapshotBlockHash: "c".repeat(64),
    valueSnapshotBlockHeight: 99,
    valueSnapshotCanonicalSummaryHash: "a".repeat(64),
    valueSnapshotGeneratedAt: "2026-01-01T00:00:00.000Z",
    valueSnapshotId: "published-h-minus-one",
    valueSnapshotMode: "canonical-summary-refresh",
    valueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
    workNetworkValueQ8: q8TextFromDecimal("1000"),
    workNetworkValueSats: "1000",
  };
  const [numericCheckpointRejected] = inceptionMintsWithLiveIssuance(
    [seedMint],
    [bond],
    ledger,
    {
      preBondCheckpoint: () => ({
        ...publishedCheckpoint,
        workNetworkValueQ8: undefined,
        workNetworkValueSats: 1_000,
      }),
    },
  );
  assert.equal(
    numericCheckpointRejected.issuanceAccountingModel,
    undefined,
    "a numeric legacy H-1 checkpoint alias cannot be promoted into exact Q8",
  );
  const [issued] = inceptionMintsWithLiveIssuance(
    [seedMint],
    [bond],
    ledger,
    { preBondCheckpoint: () => publishedCheckpoint },
  );
  assert.equal(
    issued.issuanceValueSnapshotWorkNetworkValueSats,
    "1000",
    "the published H-1 snapshot excludes every transaction in the bond block",
  );
  assert.equal(issued.amount, "556");
  assert.equal(issued.issuanceNetworkValueSats, "556");

  const [repriced] = inceptionMintsWithLiveIssuance(
    [seedMint],
    [bond],
    {
      ...ledger,
      tokenState: {
        ...ledger.tokenState,
        mints: [
          ...ledger.tokenState.mints,
          positioned(
            "5".repeat(64),
            101,
            0,
            "1970-01-01T00:00:00.000Z",
            {
              amount: 9_000_000,
              paidSats: 9_000_000,
              tokenId: "work",
            },
          ),
        ],
      },
    },
    { preBondCheckpoint: () => publishedCheckpoint },
  );
  assert.equal(
    repriced.issuanceValueSnapshotWorkNetworkValueSats,
    issued.issuanceValueSnapshotWorkNetworkValueSats,
    "current and post-bond WORK state must never reprice issuance",
  );
  assert.equal(repriced.amount, issued.amount);

});

check("empty bond summaries cannot cross bond-family identity", () => {
  const inceptionIssuanceModel =
    "canonical-pre-bond-live-network-value-v2";
  const inceptionNetworkValueModel =
    "fixed-incb-issuance-plus-market-flow-v1";
  const inceptionValueSnapshotModel =
    "canonical-summary-h-minus-one-v1";
  const bondSummaryPayloadHasKnownMainnetValue = isolatedFunction(
    API_PATH,
    "bondSummaryPayloadHasKnownMainnetValue",
    {
      INCB_TOKEN_ID: "incb",
      INCEPTION_ATTACHMENT_ACCOUNTING_MODEL: inceptionIssuanceModel,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL: inceptionIssuanceModel,
      INCEPTION_NETWORK_VALUE_ACCOUNTING_MODEL:
        inceptionNetworkValueModel,
      INCEPTION_VALUE_SNAPSHOT_MODEL: inceptionValueSnapshotModel,
      finitePositiveNumber: (value) =>
        Number.isFinite(Number(value)) && Number(value) > 0,
      isValidBitcoinAddress: (address) => address === "1registry",
      normalizePowId: (value) =>
        String(value ?? "")
          .trim()
          .replace(/@proofofwork\.me$/u, "")
          .toLowerCase(),
      numbersAgree: (left, right, tolerance = 0) =>
        Math.abs(Number(left) - Number(right)) <= tolerance,
      numericValue: (value) => Number(value) || 0,
    },
  );
  const config = {
    registryId: "inception@proofofwork.me",
    ticker: "INCB",
    tokenId: "incb",
  };
  const empty = {
    actualValue: {
      bondMintFlowSats: 0,
      networkValueAccountingModel: inceptionNetworkValueModel,
      networkValueSats: 0,
    },
    chartPoints: [],
    networkValueSats: 0,
    registryAddress: "1registry",
    registryId: config.registryId,
    stats: { confirmedBondActions: 0, confirmedSupply: 0 },
    ticker: config.ticker,
    tokenId: config.tokenId,
  };
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(empty, config, {
      allowEmptyHistory: true,
    }),
    true,
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...empty,
        actualValue: {
          ...empty.actualValue,
          networkValueAccountingModel: undefined,
        },
      },
      config,
      { allowEmptyHistory: true },
    ),
    false,
    "an empty legacy summary must not survive a network-value model change",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      { ...empty, ticker: "POWB", tokenId: "powb" },
      config,
      { allowEmptyHistory: true },
    ),
    false,
  );

  const legacyPositive = {
    ...empty,
    actualValue: { bondMintFlowSats: 546, networkValueSats: 546 },
    chartPoints: [
      {
        confirmedSupply: 546,
        floorSats: 1,
        networkValueSats: 546,
      },
    ],
    networkValueSats: 546,
    stats: { confirmedBondActions: 1, confirmedSupply: 546 },
  };
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(legacyPositive, config),
    false,
    "a proof-only legacy INCB summary must not pass the attachment-aware gate",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...legacyPositive,
        actualValue: {
          ...legacyPositive.actualValue,
          attachedWorkActions: 0,
          attachedWorkAmount: 0,
          attachedWorkFrozenValueSats: 0,
          attachedWorkLiveValueSats: 0,
          attachedWorkUnmatchedActions: 0,
          attachedWorkUnvaluedActions: 0,
          frozenFloorSats: 1,
          frozenNetworkValueSats: 546,
          liveFloorSats: 1,
          liveNetworkValueSats: 546,
        },
      },
      config,
    ),
    false,
    "field names alone cannot make a pre-model snapshot current",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...legacyPositive,
        actualValue: {
          ...legacyPositive.actualValue,
          attachedWorkActions: 0,
          attachedWorkAmount: 0,
          attachedWorkFrozenValueSats: 0,
          attachedWorkLiveValueSats: 0,
          attachedWorkUnmatchedActions: 0,
          attachedWorkUnvaluedActions: 0,
          attachmentAccountingModel: inceptionIssuanceModel,
          attachedWorkIssuanceUnits: 0,
          attachedWorkLiveFloorAtSendSats: 2,
          attachedWorkLiveValueAtSendSats: 0,
          baseNetworkValueSats: 546,
          bondMarketplaceMutationFeeSats: 0,
          bondSaleVolumeSats: 0,
          bondTransferFeeSats: 0,
          confirmedIssuanceUnits: 546,
          directProofIssuanceUnits: 546,
          frozenFloorSats: 1,
          frozenNetworkValueSats: 546,
          issuanceAccountingModel: inceptionIssuanceModel,
          issuanceCheckpointBlockHash: "e".repeat(64),
          issuanceCheckpointBlockHeight: 957_950,
          issuanceCheckpointBlockIndex: 382,
          issuanceCheckpointMode: "bond-transaction-provenance",
          issuanceValueSnapshotBlockHash: "d".repeat(64),
          issuanceValueSnapshotBlockHeight: 957_949,
          issuanceValueSnapshotCanonicalSummaryHash: "c".repeat(64),
          issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
          issuanceValueSnapshotId: "proof-only-h-minus-one",
          issuanceValueSnapshotMode: "canonical-summary-refresh",
          issuanceValueSnapshotModel: inceptionValueSnapshotModel,
          issuanceValueSnapshotWorkNetworkValueSats: "42000000",
          issuanceDustSats: 0,
          issuanceFloorSats: 1,
          issuanceNetworkValueSats: 546,
          issuanceUnitSats: 1,
          issuanceValuationFixedAtSend: true,
          liveFloorSats: 1,
          liveNetworkValueSats: 546,
          networkValueAccountingModel: inceptionNetworkValueModel,
        },
      },
      config,
    ),
    true,
    "a current-model proof-only bond remains arithmetically valid",
  );

  const productionPrecisionActual = {
    attachedWorkActions: 24,
    attachedWorkAmount: 79_488_720,
    attachedWorkFrozenValueSats: 9_957_991_138_328.822,
    attachedWorkIssuanceUnits: 9_957_991_138_317,
    attachedWorkLiveFloorAtSendSats: 125_275.52511008886,
    attachedWorkLiveValueAtSendSats: 9_957_991_138_328.822,
    attachedWorkLiveValueSats: 9_957_991_138_328.822,
    attachedWorkUnmatchedActions: 0,
    attachedWorkUnvaluedActions: 0,
    attachmentAccountingModel: inceptionIssuanceModel,
    baseNetworkValueSats: 14_104,
    bondMarketplaceMutationFeeSats: 0,
    bondMintFlowSats: 14_104,
    bondSaleVolumeSats: 0,
    bondTransferFeeSats: 0,
    confirmedIssuanceUnits: 9_957_991_152_421,
    directProofIssuanceUnits: 14_104,
    frozenFloorSats: 1.0000000000011873,
    frozenNetworkValueSats: 9_957_991_152_432.822,
    issuanceAccountingModel: inceptionIssuanceModel,
    issuanceCheckpointBlockHash:
      "0000000000000000000157976425b0a5e3d6d0ee8358611e957486873f862f85",
    issuanceCheckpointBlockHeight: 958_197,
    issuanceCheckpointBlockIndex: 2_014,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustSats: 11.822265625,
    issuanceFloorSats: 1.0000000000011873,
    issuanceNetworkValueSats: 9_957_991_152_432.822,
    issuanceUnitSats: 1,
    issuanceValuationFixedAtSend: true,
    issuanceValueSnapshotBlockHash:
      "000000000000000000009c6cae5edf2187ec681b47969ac79d07f1f713fea460",
    issuanceValueSnapshotBlockHeight: 958_196,
    issuanceValueSnapshotCanonicalSummaryHash:
      "2d76510da97e2703c76896eaa774e8fdf8e0cd040d49f0d2443e871b675ae475",
    issuanceValueSnapshotGeneratedAt: "2026-07-15T20:40:11.158Z",
    issuanceValueSnapshotId: "e59bf41d4ced5cb965cb0cb6",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: inceptionValueSnapshotModel,
    issuanceValueSnapshotWorkNetworkValueSats: 16_941_906_432_781.268,
    liveFloorSats: 1.0000000000011873,
    liveNetworkValueSats: 9_957_991_152_432.822,
    networkValueAccountingModel: inceptionNetworkValueModel,
    networkValueSats: 9_957_991_152_432.822,
  };
  const productionPrecisionSummary = {
    ...empty,
    actualValue: productionPrecisionActual,
    chartPoints: [
      {
        confirmedSupply: 9_957_991_152_421,
        floorSats: productionPrecisionActual.liveFloorSats,
        networkValueSats: productionPrecisionActual.liveNetworkValueSats,
      },
    ],
    networkValueSats: productionPrecisionActual.liveNetworkValueSats,
    stats: {
      confirmedBondActions: 25,
      confirmedSupply: 9_957_991_152_421,
    },
  };
  assert.equal(
    productionPrecisionActual.liveFloorSats *
      productionPrecisionSummary.stats.confirmedSupply,
    productionPrecisionActual.liveNetworkValueSats,
    "the fixed production-scale floor must reconcile to issuance value",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      productionPrecisionSummary,
      config,
    ),
    true,
    "a production-scale fixed INCB summary must remain valid",
  );
  const currentMagnitudeActual = {
    ...productionPrecisionActual,
    attachedWorkActions: 29,
    attachedWorkAmount: 79_488_720,
    attachedWorkFrozenValueSats: 108_304_295_445_983.2,
    attachedWorkIssuanceUnits: 108_304_295_445_969,
    attachedWorkLiveFloorAtSendSats:
      108_304_295_445_983.2 / 79_488_720,
    attachedWorkLiveValueAtSendSats: 108_304_295_445_983.2,
    attachedWorkLiveValueSats: 108_304_295_445_983.2,
    baseNetworkValueSats: 16_834,
    bondMintFlowSats: 16_834,
    confirmedIssuanceUnits: 108_304_295_462_803,
    directProofIssuanceUnits: 16_834,
    floorSats: 1.0000000000001312,
    frozenFloorSats: 1.0000000000001312,
    frozenNetworkValueSats: 108_304_295_462_817.2,
    issuanceDustSats: 14.203125,
    issuanceFloorSats: 1.0000000000001312,
    issuanceNetworkValueSats: 108_304_295_462_817.2,
    liveFloorSats: 1.0000000000001312,
    liveNetworkValueSats: 108_304_295_462_817.2,
    networkValueSats: 108_304_295_462_817.2,
  };
  const currentMagnitudeSummary = {
    ...productionPrecisionSummary,
    actualValue: currentMagnitudeActual,
    chartPoints: [
      {
        confirmedSupply: currentMagnitudeActual.confirmedIssuanceUnits,
        floorSats: currentMagnitudeActual.liveFloorSats,
        networkValueSats: currentMagnitudeActual.liveNetworkValueSats,
      },
    ],
    networkValueSats: currentMagnitudeActual.networkValueSats,
    stats: {
      confirmedBondActions: 30,
      confirmedSupply: currentMagnitudeActual.confirmedIssuanceUnits,
    },
  };
  assert.equal(
    currentMagnitudeActual.issuanceFloorSats *
      currentMagnitudeActual.confirmedIssuanceUnits -
      currentMagnitudeActual.issuanceNetworkValueSats,
    0.015625,
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(currentMagnitudeSummary, config),
    true,
    "the public reader accepts sub-proof arithmetic noise at the current INCB scale",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...currentMagnitudeSummary,
        actualValue: {
          ...currentMagnitudeActual,
          liveNetworkValueSats:
            currentMagnitudeActual.liveNetworkValueSats + 1,
        },
      },
      config,
    ),
    false,
    "the public reader still rejects a one-proof current-scale discrepancy",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...productionPrecisionSummary,
        actualValue: {
          ...productionPrecisionActual,
          liveFloorSats:
            productionPrecisionActual.liveFloorSats +
            1 / productionPrecisionSummary.stats.confirmedSupply,
        },
      },
      config,
    ),
    false,
    "the scale-aware floor check must still reject a one-proof discrepancy",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...legacyPositive,
        actualValue: {
          ...legacyPositive.actualValue,
          attachedWorkActions: 1,
          attachedWorkAmount: 100,
          attachedWorkFrozenValueSats: 200,
          attachedWorkLiveValueSats: 200,
          attachedWorkUnmatchedActions: 1,
          attachedWorkUnvaluedActions: 0,
          attachmentAccountingModel: inceptionIssuanceModel,
          attachedWorkIssuanceUnits: 200,
          attachedWorkLiveFloorAtSendSats: 2,
          attachedWorkLiveValueAtSendSats: 200,
          baseNetworkValueSats: 546,
          bondMarketplaceMutationFeeSats: 0,
          bondSaleVolumeSats: 0,
          bondTransferFeeSats: 0,
          confirmedIssuanceUnits: 746,
          directProofIssuanceUnits: 546,
          frozenFloorSats: 1,
          frozenNetworkValueSats: 746,
          issuanceAccountingModel: inceptionIssuanceModel,
          issuanceCheckpointBlockHash: "e".repeat(64),
          issuanceCheckpointBlockHeight: 957_950,
          issuanceCheckpointBlockIndex: 382,
          issuanceCheckpointMode: "bond-transaction-provenance",
          issuanceValueSnapshotBlockHash: "d".repeat(64),
          issuanceValueSnapshotBlockHeight: 957_949,
          issuanceValueSnapshotCanonicalSummaryHash: "c".repeat(64),
          issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
          issuanceValueSnapshotId: "attached-h-minus-one",
          issuanceValueSnapshotMode: "canonical-summary-refresh",
          issuanceValueSnapshotModel: inceptionValueSnapshotModel,
          issuanceValueSnapshotWorkNetworkValueSats: 42_000_000,
          issuanceDustSats: 0,
          issuanceFloorSats: 1,
          issuanceNetworkValueSats: 746,
          liveFloorSats: 1,
          liveNetworkValueSats: 746,
          networkValueAccountingModel: inceptionNetworkValueModel,
          networkValueSats: 746,
        },
        chartPoints: [
          { confirmedSupply: 746, floorSats: 1, networkValueSats: 746 },
        ],
        networkValueSats: 746,
        stats: { confirmedBondActions: 1, confirmedSupply: 746 },
      },
      config,
    ),
    false,
    "a partially matched declared WORK attachment must fail closed",
  );
  assert.match(
    topLevelFunctionSource(API_PATH, "internalCanonicalSummaryPayload"),
    /summaryPayloadHasFiniteNetworkValue\(\s*network,\s*key,\s*payload,?\s*\)/u,
    "canonical summary publication must validate every financial payload",
  );
});

check("invalid canonical Inception composites never escape ledger fallback", async () => {
  const config = {
    displayName: "Inception Bond",
    summaryKey: "inceptionSummary",
    summaryRoute: "inception-summary",
    tokenId: "incb",
  };
  const ledger = {
    inceptionSummary: {
      registryAddress: "1registry",
      stats: { confirmedBondActions: 2, confirmedSupply: 2, holders: 1 },
    },
  };
  let indexed = null;
  let canonical = { validComposite: false };
  const bondSummaryPayload = isolatedFunction(API_PATH, "bondSummaryPayload", {
    LEDGER_SUMMARY_FRESH_WAIT_MS: 1_000,
    bondSummaryFromCanonicalLedger: async () => canonical,
    currentProofIndexSummarySnapshotFallbackPayload: async () => null,
    existingCurrentCanonicalLedgerPayloadWithinMs: async () => ledger,
    freshDataUnavailableError: (message) => {
      const error = new Error(message);
      error.statusCode = 503;
      return error;
    },
    numericValue: (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    },
    payloadWithFallbackAfterMs: async (promise) => promise,
    proofIndexBondSummaryPayload: async () => indexed,
    standaloneBondSummaryPayload: async () => null,
    summaryCanonicalLedgerPayload: async () => ledger,
    summaryPayloadHasFiniteNetworkValue: (_network, _key, payload) =>
      payload?.validComposite === true,
  });

  indexed = {
    marker: "validated-indexed",
    stats: { confirmedBondActions: 1, confirmedSupply: 1, holders: 1 },
  };
  assert.equal(
    (await bondSummaryPayload("livenet", true, config)).marker,
    "validated-indexed",
  );

  indexed = null;
  await rejection(
    bondSummaryPayload("livenet", true, config),
    (error) => error?.statusCode === 503,
  );

  canonical = { validComposite: true };
  assert.equal(
    (await bondSummaryPayload("livenet", true, config)).validComposite,
    true,
  );
});

check("a canonical zero-supply INCB definition is known token history", () => {
  const incbTokenId = "incb";
  const tokenPayloadHasKnownMainnetHistory = isolatedFunction(
    API_PATH,
    "tokenPayloadHasKnownMainnetHistory",
    {
      BOND_TOKEN_IDS: new Set([incbTokenId]),
      INCB_TOKEN_ID: incbTokenId,
      WORK_TOKEN_ID: "work",
      bondConfigForTokenId: (tokenId) =>
        tokenId === incbTokenId
          ? { ticker: "INCB", tokenId: incbTokenId }
          : null,
      isValidBitcoinAddress: (address) => address === "1registry",
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
    },
  );
  assert.equal(
    tokenPayloadHasKnownMainnetHistory(
      {
        confirmedSupply: 0,
        holders: [],
        listings: [],
        mints: [],
        sales: [],
        tokens: [
          {
            confirmed: true,
            registryAddress: "1registry",
            ticker: "INCB",
            tokenId: incbTokenId,
          },
        ],
        transfers: [],
      },
      incbTokenId,
    ),
    true,
  );
});

check("a hashless legacy block checkpoint cannot resume automatically", async () => {
  const latestBlockScanCheckpoint = isolatedFunction(
    BACKFILL_PATH,
    "latestBlockScanCheckpoint",
    {
      BLOCK_SCAN_FROM_HEIGHT: 0,
      NETWORK: "livenet",
    },
  );
  await rejection(
    latestBlockScanCheckpoint({
      async query() {
        return {
          rows: [{ block_hash: "", indexed_through_block: 957_000 }],
        };
      },
    }),
    (error) => /no canonical block hash|supervised replay/iu.test(error.message),
    "a hashless legacy checkpoint was accepted for automatic resume",
  );
});

check("an explicit supervised block replay owns its starting height", async () => {
  const latestBlockScanCheckpoint = isolatedFunction(
    BACKFILL_PATH,
    "latestBlockScanCheckpoint",
    {
      BLOCK_SCAN_FROM_HEIGHT: 956_000,
      NETWORK: "livenet",
    },
  );
  const checkpoint = await latestBlockScanCheckpoint({
    async query() {
      assert.fail("explicit replay unexpectedly read a legacy checkpoint");
    },
  });
  assert.equal(checkpoint.height, 955_999);
  assert.equal(checkpoint.blockHash, "");
});

check("a timed-out worker child is terminated and reported failed", async () => {
  const cancelledTimers = new Set();
  let nextTimer = 0;
  const fakeSetTimeout = (callback) => {
    const timer = ++nextTimer;
    queueMicrotask(() => {
      if (!cancelledTimers.has(timer)) {
        callback();
      }
    });
    return timer;
  };
  const kills = [];
  const child = new EventEmitter();
  child.kill = (signal) => {
    kills.push(signal);
    if (signal === "SIGTERM") {
      queueMicrotask(() => child.emit("close", null, signal));
    }
    return true;
  };
  const runScript = isolatedFunction(
    WORKER_PATH,
    "runScript",
    {
      BACKFILL_CHILD_TIMEOUT_MS: 100,
      CHILD_LINE_BUFFER_CHARS: 16_384,
      CHILD_STOP_GRACE_MS: 5_000,
      canonicalWorkerFailureFromLine: () => null,
      clearTimeout: (timer) => cancelledTimers.add(timer),
      path: { join: (...parts) => parts.join("/") },
      process: { env: {}, execPath: "node" },
      repoRoot: "/tmp/recovery-fixture",
      setTimeout: fakeSetTimeout,
      spawn: () => child,
    },
  );
  await rejection(
    runScript("fixture.mjs", [], {}, { timeoutMs: 10 }),
    (error) => /wall-clock budget/iu.test(error.message),
  );
  assert.deepEqual(kills, ["SIGTERM"]);
});

check("the index worker retries a failed block cycle before going unhealthy", async () => {
  let attempts = 0;
  const runBackfillWithRetries = isolatedFunction(
    WORKER_PATH,
    "runBackfillWithRetries",
    {
      BACKFILL_CHILD_TIMEOUT_MS: 1_000,
      BACKFILL_RETRIES: 2,
      BACKFILL_RETRY_DELAY_MS: 1,
      canonicalWorkerFailureFromError: () => null,
      console: { error() {} },
      runScript: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("tip changed");
        }
      },
      setTimeout: (callback) => {
        queueMicrotask(callback);
        return 1;
      },
      workerSleep: async () => {},
    },
  );
  await runBackfillWithRetries({});
  assert.equal(attempts, 2);
});

check("pending drops enforce a five-minute floor and exact Core proof", () => {
  const confirmationMs = isolatedFunction(
    WORKER_PATH,
    "pendingDropConfirmationMs",
  );
  for (const value of [undefined, "", 0, 1, -1, "invalid", Infinity]) {
    assert.equal(confirmationMs(value), 5 * 60_000);
  }
  assert.equal(confirmationMs(5 * 60_000), 5 * 60_000);
  assert.equal(confirmationMs(10 * 60_000), 10 * 60_000);

  const exactEvidence = isolatedFunction(
    WORKER_PATH,
    "authoritativeDroppedStatusEvidence",
  );
  const sources = [
    "bitcoin-core:getrawtransaction",
    "bitcoin-core:getmempoolentry",
    "bitcoin-core:getblockchaininfo",
    "bitcoin-core:getindexinfo:txindex",
  ];
  const evidence = {
    absenceProven: true,
    contract: "proof-of-work-tx-status-v2",
    reason:
      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
    sources,
  };
  assert.equal(exactEvidence(evidence), true);
  assert.equal(exactEvidence({ ...evidence, sources: [...sources].reverse() }), true);
  assert.equal(exactEvidence({ ...evidence, absenceProven: false }), false);
  assert.equal(exactEvidence({ ...evidence, contract: "proof-of-work-tx-status-v1" }), false);
  assert.equal(exactEvidence({ ...evidence, reason: `${evidence.reason}-other` }), false);
  for (let index = 0; index < sources.length; index += 1) {
    assert.equal(
      exactEvidence({
        ...evidence,
        sources: sources.filter((_source, sourceIndex) => sourceIndex !== index),
      }),
      false,
    );
  }
  assert.equal(
    exactEvidence({ ...evidence, sources: [...sources, "bitcoin-core:extra"] }),
    false,
  );
  assert.equal(
    exactEvidence({ ...evidence, sources: [sources[0], sources[0], sources[2], sources[3]] }),
    false,
  );
});

check("pending status cleanup is concurrent but capped", async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  const rows = Array.from({ length: 12 }, (_value, index) => ({
    txid: String(index).padStart(64, "0"),
  }));
  const refreshPendingStatuses = isolatedFunction(
    WORKER_PATH,
    "refreshPendingStatuses",
    {
      NETWORK: "livenet",
      PENDING_MIN_AGE_MS: 60_000,
      PENDING_STATUS_BUDGET_MS: 15_000,
      PENDING_STATUS_CONCURRENCY: 5,
      PENDING_STATUS_LIMIT: 25,
      STATUS_REQUEST_TIMEOUT_MS: 5_000,
      endpoint: (pathname) => new URL(pathname, "http://127.0.0.1:8081"),
      readJson: async () => {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setImmediate(resolve));
        activeReads -= 1;
        return { status: "pending" };
      },
      updateTransactionStatus: async () => ({ applied: true }),
    },
  );
  const pool = {
    async connect() {
      return {
        async query() {},
        release() {},
      };
    },
    async query() {
      return { rowCount: rows.length, rows };
    },
  };
  const summary = await refreshPendingStatuses(pool);
  assert.equal(summary.checked, rows.length);
  assert.equal(summary.pending, rows.length);
  assert.equal(summary.deferred, 0);
  assert.equal(maxActiveReads, 5);
});

check("worker status transitions are proven, race-safe, and projection-safe", async () => {
  const txid = "9".repeat(64);
  const now = Date.now();
  const observedAt = new Date(now).toISOString();
  const mempoolFirstSeenAt = new Date(now - 60_000).toISOString();
  const authoritativeDroppedStatusEvidence = isolatedFunction(
    WORKER_PATH,
    "authoritativeDroppedStatusEvidence",
  );
  const statusUpdate = isolatedFunction(
    WORKER_PATH,
    "updateTransactionStatus",
    {
      NETWORK: "livenet",
      PENDING_DROP_CONFIRMATION_MS: 5 * 60_000,
      authoritativeDroppedStatusEvidence,
    },
  );
  const pendingEnvelope = {
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    mempoolFirstSeenAt,
    mempoolSeen: true,
    network: "livenet",
    observedAt,
    sources: ["bitcoin-core:getmempoolentry"],
    status: "pending",
    txid,
  };

  const pendingQueries = [];
  const pendingClient = {
    async query(sql, params) {
      pendingQueries.push({ params, sql });
      if (/SELECT status, raw_tx/iu.test(sql)) {
        return { rows: [{ raw_tx: {}, status: "pending" }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const pendingOutcome = await statusUpdate(
    pendingClient,
    txid,
    "pending",
    pendingEnvelope,
  );
  assert.equal(pendingOutcome.applied, true);
  assert.equal(pendingQueries.length, 5);
  assert.match(
    pendingQueries[1].sql,
    /UPDATE proof_indexer\.transactions/iu,
  );
  assert.doesNotMatch(pendingQueries[1].sql, /\bevent_time\b/iu);
  assert.match(pendingQueries[1].sql, /block_hash = NULL/iu);
  assert.match(pendingQueries[2].sql, /UPDATE proof_indexer\.events/iu);
  assert.match(pendingQueries[2].sql, /\bpayload\b/iu);
  assert.doesNotMatch(pendingQueries[2].sql, /\bmessage\b|\bmetadata\b/iu);
  assert.match(pendingQueries[3].sql, /UPDATE proof_indexer\.mail_items/iu);
  assert.match(pendingQueries[3].sql, /\bmessage\b/iu);
  assert.doesNotMatch(pendingQueries[3].sql, /\bpayload\b|\bmetadata\b/iu);
  assert.match(
    pendingQueries[4].sql,
    /UPDATE proof_indexer\.file_attachments/iu,
  );
  assert.match(pendingQueries[4].sql, /\bmetadata\b/iu);
  assert.doesNotMatch(pendingQueries[4].sql, /\bpayload\b|\bmessage\b/iu);
  assert.match(pendingQueries[2].sql, /status = 'pending'/iu);
  assert.match(
    pendingQueries[2].sql,
    /ELSE LEAST\([\s\S]*event_time[\s\S]*to_timestamp/iu,
  );
  for (const queryIndex of [2, 3, 4]) {
    assert.match(pendingQueries[queryIndex].sql, /- 'createdAt'/u);
    assert.match(pendingQueries[queryIndex].sql, /- 'timestamp'/u);
    assert.match(
      pendingQueries[queryIndex].sql,
      /'createdAt',[\s\S]*to_timestamp/iu,
    );
    assert.match(
      pendingQueries[queryIndex].sql,
      /'timestamp',[\s\S]*to_timestamp/iu,
    );
  }
  assert.match(
    pendingQueries[2].sql,
    /IS DISTINCT FROM[\s\S]*to_timestamp/iu,
  );
  assert.match(pendingQueries[2].sql, /payload \?\| ARRAY/iu);
  assert.match(pendingQueries[2].sql, /WHERE[\s\S]*status = 'pending'/iu);

  const confirmedQueries = [];
  const confirmedOutcome = await statusUpdate(
    {
      async query(sql) {
        confirmedQueries.push(sql);
        return { rows: [{ raw_tx: {}, status: "pending" }] };
      },
    },
    txid,
    "confirmed",
    {
      blockHash: "a".repeat(64),
      blockHeight: 123,
      blockTime: new Date(now - 120_000).toISOString(),
      canonical: true,
      confirmed: true,
      contract: "proof-of-work-tx-status-v2",
      network: "livenet",
      observedAt,
      sources: ["bitcoin-core:getblock"],
      status: "confirmed",
      txid,
    },
  );
  assert.equal(confirmedOutcome.applied, false);
  assert.equal(confirmedOutcome.reason, "canonical-block-scan-required");
  assert.equal(confirmedQueries.length, 2);
  assert.match(confirmedQueries[1], /statusObservation/iu);

  let invalidQueries = 0;
  await rejection(
    statusUpdate(
      {
        async query() {
          invalidQueries += 1;
        },
      },
      txid,
      "confirmed",
      {
        confirmed: true,
        contract: "proof-of-work-tx-status-v2",
        network: "livenet",
        observedAt,
        sources: ["bitcoin-core:getblock"],
        status: "confirmed",
        txid,
      },
    ),
    (error) => /Unproven confirmed status/iu.test(error.message),
  );
  assert.equal(invalidQueries, 0);

  const raceQueries = [];
  const raceOutcome = await statusUpdate(
    {
      async query(sql) {
        raceQueries.push(sql);
        return { rows: [{ raw_tx: {}, status: "confirmed" }] };
      },
    },
    txid,
    "pending",
    pendingEnvelope,
  );
  assert.equal(raceOutcome.applied, false);
  assert.equal(raceOutcome.reason, "status-race");
  assert.equal(raceQueries.length, 1);

  const absentEnvelope = {
    absenceProven: true,
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    network: "livenet",
    observedAt,
    reason:
      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
    sources: [
      "bitcoin-core:getrawtransaction",
      "bitcoin-core:getmempoolentry",
      "bitcoin-core:getblockchaininfo",
      "bitcoin-core:getindexinfo:txindex",
    ],
    status: "dropped",
    txid,
  };
  const firstAbsenceQueries = [];
  const firstAbsence = await statusUpdate(
    {
      async query(sql) {
        firstAbsenceQueries.push(sql);
        if (/SELECT status, raw_tx/iu.test(sql)) {
          return { rows: [{ raw_tx: {}, status: "pending" }] };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    txid,
    "dropped",
    absentEnvelope,
  );
  assert.equal(firstAbsence.applied, false);
  assert.equal(firstAbsence.reason, "repeat-absence-required");
  assert.equal(firstAbsenceQueries.length, 2);

  const repeatedAbsenceQueries = [];
  const repeatedAbsence = await statusUpdate(
    {
      async query(sql) {
        repeatedAbsenceQueries.push(sql);
        if (/SELECT status, raw_tx/iu.test(sql)) {
          return {
            rows: [
              {
                raw_tx: {
                  statusObservation: {
                    absenceCount: 1,
                    absenceProven: true,
                    absenceStartedAt: new Date(now - 5 * 60_000).toISOString(),
                    contract: "proof-of-work-tx-status-v2",
                    observedAt: new Date(now - 60_000).toISOString(),
                    reason:
                      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
                    sources: [
                      "bitcoin-core:getrawtransaction",
                      "bitcoin-core:getmempoolentry",
                      "bitcoin-core:getblockchaininfo",
                      "bitcoin-core:getindexinfo:txindex",
                    ],
                    status: "dropped",
                  },
                },
                status: "pending",
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    txid,
    "dropped",
    absentEnvelope,
  );
  assert.equal(repeatedAbsence.applied, true);
  const listingUpdates = repeatedAbsenceQueries.filter((sql) =>
    /UPDATE proof_indexer\.credit_listings/iu.test(sql),
  );
  assert.equal(listingUpdates.length, 2);
  const initialListingDrop = listingUpdates.find((sql) =>
    /listing_id = \$2 AND status = 'pending'/iu.test(sql),
  );
  const lifecycleRestore = listingUpdates.find((sql) =>
    /WITH affected AS/iu.test(sql),
  );
  assert.match(initialListingDrop, /status = 'dropped'/iu);
  assert.match(lifecycleRestore, /ELSE 'active'/iu);
  assert.match(lifecycleRestore, /THEN 'sealing'/iu);
  assert.match(lifecycleRestore, /buyer_address = NULL/iu);
  assert.match(lifecycleRestore, /base_event\.payload AS base_payload/iu);
  for (const staleKey of [
    "buyerAddress",
    "closeTxid",
    "closedTxid",
    "saleTxid",
  ]) {
    assert.match(lifecycleRestore, new RegExp(`- '${staleKey}'`, "u"));
  }
});

check("rapid authoritative absences preserve one confirmation epoch", async () => {
  const txid = "8".repeat(64);
  const confirmationMs = 5 * 60_000;
  const baseMs = Date.now() - 15 * 60_000;
  const authoritativeDroppedStatusEvidence = isolatedFunction(
    WORKER_PATH,
    "authoritativeDroppedStatusEvidence",
  );
  const statusUpdate = isolatedFunction(
    WORKER_PATH,
    "updateTransactionStatus",
    {
      NETWORK: "livenet",
      PENDING_DROP_CONFIRMATION_MS: confirmationMs,
      authoritativeDroppedStatusEvidence,
    },
  );
  const absenceEnvelopeAt = (observedAtMs) => ({
    absenceProven: true,
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    network: "livenet",
    observedAt: new Date(observedAtMs).toISOString(),
    reason:
      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
    sources: [
      "bitcoin-core:getrawtransaction",
      "bitcoin-core:getmempoolentry",
      "bitcoin-core:getblockchaininfo",
      "bitcoin-core:getindexinfo:txindex",
    ],
    status: "dropped",
    txid,
  });
  const pendingEnvelopeAt = (observedAtMs) => ({
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    mempoolFirstSeenAt: new Date(baseMs - 60_000).toISOString(),
    mempoolSeen: true,
    network: "livenet",
    observedAt: new Date(observedAtMs).toISOString(),
    sources: ["bitcoin-core:getmempoolentry"],
    status: "pending",
    txid,
  });
  const confirmedEnvelopeAt = (observedAtMs) => ({
    blockHash: "7".repeat(64),
    blockHeight: 123,
    blockTime: new Date(observedAtMs - 60_000).toISOString(),
    canonical: true,
    confirmed: true,
    contract: "proof-of-work-tx-status-v2",
    network: "livenet",
    observedAt: new Date(observedAtMs).toISOString(),
    sources: ["bitcoin-core:getblock"],
    status: "confirmed",
    txid,
  });
  const makeClient = () => {
    const state = { raw_tx: {}, status: "pending" };
    const statements = [];
    return {
      state,
      statements,
      async query(sql, params) {
        statements.push({ params, sql });
        if (/SELECT status, raw_tx/iu.test(sql)) {
          return {
            rows: [
              {
                raw_tx: JSON.parse(JSON.stringify(state.raw_tx)),
                status: state.status,
              },
            ],
          };
        }
        if (/UPDATE proof_indexer\.transactions/iu.test(sql)) {
          const observationIndex = /first_seen_at/iu.test(sql) ? 3 : 2;
          if (typeof params?.[observationIndex] === "string") {
            state.raw_tx.statusObservation = JSON.parse(
              params[observationIndex],
            );
          }
          if (/SET\s+status = 'dropped'/iu.test(sql)) {
            state.status = "dropped";
          }
        }
        return { rowCount: 1, rows: [] };
      },
    };
  };

  const rapid = makeClient();
  for (const [offsetMs, expectedCount] of [
    [0, 1],
    [60_000, 2],
    [confirmationMs - 1, 3],
  ]) {
    const outcome = await statusUpdate(
      rapid,
      txid,
      "dropped",
      absenceEnvelopeAt(baseMs + offsetMs),
    );
    assert.equal(outcome.applied, false);
    assert.equal(outcome.reason, "repeat-absence-required");
    assert.equal(
      rapid.state.raw_tx.statusObservation.absenceCount,
      expectedCount,
    );
    assert.equal(
      rapid.state.raw_tx.statusObservation.absenceStartedAt,
      new Date(baseMs).toISOString(),
    );
  }
  const matured = await statusUpdate(
    rapid,
    txid,
    "dropped",
    absenceEnvelopeAt(baseMs + confirmationMs),
  );
  assert.equal(matured.applied, true);
  assert.equal(rapid.state.status, "dropped");
  assert.equal(rapid.state.raw_tx.statusObservation.absenceCount, 4);
  assert.equal(
    rapid.state.raw_tx.statusObservation.absenceStartedAt,
    new Date(baseMs).toISOString(),
  );
  assert.equal(rapid.state.raw_tx.statusObservation.absenceProven, true);
  for (const table of ["events", "mail_items", "file_attachments"]) {
    const transition = rapid.statements.find(({ sql }) =>
      new RegExp(`UPDATE proof_indexer\\.${table}`, "iu").test(sql),
    );
    assert.match(transition.sql, /'dropped', true/iu);
  }

  const pendingReset = makeClient();
  await statusUpdate(
    pendingReset,
    txid,
    "dropped",
    absenceEnvelopeAt(baseMs),
  );
  await statusUpdate(
    pendingReset,
    txid,
    "pending",
    pendingEnvelopeAt(baseMs + 60_000),
  );
  assert.equal(pendingReset.state.raw_tx.statusObservation.status, "pending");
  assert.equal(pendingReset.state.raw_tx.statusObservation.absenceCount, 0);
  const afterPending = await statusUpdate(
    pendingReset,
    txid,
    "dropped",
    absenceEnvelopeAt(baseMs + confirmationMs + 60_000),
  );
  assert.equal(afterPending.applied, false);
  assert.equal(
    pendingReset.state.raw_tx.statusObservation.absenceStartedAt,
    new Date(baseMs + confirmationMs + 60_000).toISOString(),
  );

  const confirmedReset = makeClient();
  await statusUpdate(
    confirmedReset,
    txid,
    "dropped",
    absenceEnvelopeAt(baseMs),
  );
  const confirmed = await statusUpdate(
    confirmedReset,
    txid,
    "confirmed",
    confirmedEnvelopeAt(baseMs + 60_000),
  );
  assert.equal(confirmed.applied, false);
  assert.equal(confirmed.reason, "canonical-block-scan-required");
  assert.equal(
    confirmedReset.state.raw_tx.statusObservation.status,
    "confirmed",
  );
  const afterConfirmed = await statusUpdate(
    confirmedReset,
    txid,
    "dropped",
    absenceEnvelopeAt(baseMs + confirmationMs + 60_000),
  );
  assert.equal(afterConfirmed.applied, false);
  assert.equal(
    confirmedReset.state.raw_tx.statusObservation.absenceStartedAt,
    new Date(baseMs + confirmationMs + 60_000).toISOString(),
  );

  const validPrior = {
    ...absenceEnvelopeAt(baseMs),
    absenceCount: 2,
    absenceStartedAt: new Date(baseMs).toISOString(),
  };
  const malformedPriors = [
    {
      absenceCount: 2,
      absenceStartedAt: new Date(baseMs).toISOString(),
      observedAt: new Date(baseMs).toISOString(),
      status: "dropped",
    },
    { ...validPrior, absenceProven: false },
    { ...validPrior, contract: "proof-of-work-tx-status-v1" },
    { ...validPrior, reason: `${validPrior.reason}-other` },
    { ...validPrior, sources: validPrior.sources.slice(0, -1) },
    { ...validPrior, absenceStartedAt: undefined },
  ];
  const afterInvalidPriorAt = baseMs + confirmationMs + 60_000;
  for (const prior of malformedPriors) {
    const client = makeClient();
    client.state.raw_tx.statusObservation = prior;
    const outcome = await statusUpdate(
      client,
      txid,
      "dropped",
      absenceEnvelopeAt(afterInvalidPriorAt),
    );
    assert.equal(outcome.applied, false);
    assert.equal(outcome.reason, "repeat-absence-required");
    assert.equal(client.state.status, "pending");
    assert.equal(client.state.raw_tx.statusObservation.absenceCount, 1);
    assert.equal(
      client.state.raw_tx.statusObservation.absenceStartedAt,
      new Date(afterInvalidPriorAt).toISOString(),
    );
  }

  const exactSources = absenceEnvelopeAt(baseMs).sources;
  const unprovenEnvelopes = [
    { ...absenceEnvelopeAt(baseMs), absenceProven: false },
    { ...absenceEnvelopeAt(baseMs), reason: "generic-core-absence" },
    { ...absenceEnvelopeAt(baseMs), sources: exactSources.slice(0, -1) },
    {
      ...absenceEnvelopeAt(baseMs),
      sources: [...exactSources, "bitcoin-core:extra"],
    },
  ];
  for (const envelope of unprovenEnvelopes) {
    let ambiguousQueries = 0;
    await rejection(
      statusUpdate(
        {
          async query() {
            ambiguousQueries += 1;
          },
        },
        txid,
        "dropped",
        envelope,
      ),
      (error) => /Unproven dropped status/iu.test(error.message),
    );
    assert.equal(ambiguousQueries, 0);
  }
});

check("rebroadcast pending transactions clear every prior drop observation", async () => {
  let statement = "";
  const upsertTransaction = isolatedFunction(
    BACKFILL_PATH,
    "upsertTransaction",
    {
      NETWORK: "livenet",
      itemTime: (item) => item.createdAt,
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
    },
  );
  await upsertTransaction(
    {
      async query(sql) {
        statement = String(sql);
        return { rows: [] };
      },
    },
    { confirmed: false, createdAt: "2026-07-14T18:00:00.000Z" },
    "a".repeat(64),
    "pending",
    "mempool-scan",
  );
  assert.match(statement, /dropped_at = CASE[\s\S]*THEN NULL/u);
  assert.match(statement, /dropped_reason = CASE[\s\S]*THEN NULL/u);
  assert.match(statement, /replaced_by_txid = CASE[\s\S]*THEN NULL/u);
  assert.match(statement, /- 'statusObservation'/u);
});

check("mempool scan cursor crosses the processed-txid retention boundary", () => {
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const normalizedMempoolScanCursor = isolatedFunction(
    BACKFILL_PATH,
    "normalizedMempoolScanCursor",
    { isHexTxid },
  );
  const mempoolEntriesAfterCursor = isolatedFunction(
    BACKFILL_PATH,
    "mempoolEntriesAfterCursor",
    { normalizedMempoolScanCursor },
  );
  const plannedMempoolScanCandidates = isolatedFunction(
    BACKFILL_PATH,
    "plannedMempoolScanCandidates",
    { isHexTxid, mempoolEntriesAfterCursor },
  );
  const txid = (index) => index.toString(16).padStart(64, "0");
  const entries = Array.from({ length: 10_005 }, (_value, index) => [
    txid(index),
    { time: 20_000 - index },
  ]);
  const processedTxids = new Set(
    entries.slice(0, 10_000).map(([entryTxid]) => entryTxid),
  );
  const candidates = plannedMempoolScanCandidates(
    entries,
    { cursor: null, processedTxids },
    [],
    { candidateLimit: 5, seenLimit: 10_000 },
  );
  assert.deepEqual(
    Array.from(candidates, (candidate) => candidate.entry[0]),
    entries.slice(10_000).map(([entryTxid]) => entryTxid),
  );
  assert.ok(candidates.every((candidate) => candidate.lane === "cursor"));
});

check("mempool scan cursor wraps and survives anchor eviction", () => {
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const normalizedMempoolScanCursor = isolatedFunction(
    BACKFILL_PATH,
    "normalizedMempoolScanCursor",
    { isHexTxid },
  );
  const mempoolEntriesAfterCursor = isolatedFunction(
    BACKFILL_PATH,
    "mempoolEntriesAfterCursor",
    { normalizedMempoolScanCursor },
  );
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const c = "c".repeat(64);
  const d = "d".repeat(64);
  const e = "e".repeat(64);
  const entries = [
    [a, { time: 5 }],
    [b, { time: 4 }],
    [c, { time: 3 }],
    [e, { time: 1 }],
  ];
  assert.deepEqual(
    Array.from(
      mempoolEntriesAfterCursor(entries, { time: 2, txid: d }),
      ([txid]) => txid,
    ),
    [e, a, b, c],
  );
  assert.deepEqual(
    Array.from(
      mempoolEntriesAfterCursor(entries, { time: 1, txid: e }),
      ([txid]) => txid,
    ),
    [a, b, c, e],
  );
});

check("legacy mempool scan state round-trips without inventing a cursor", async () => {
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const normalizedMempoolScanCursor = isolatedFunction(
    BACKFILL_PATH,
    "normalizedMempoolScanCursor",
    { isHexTxid },
  );
  const mempoolScanState = isolatedFunction(
    BACKFILL_PATH,
    "mempoolScanState",
    { NETWORK: "livenet", normalizedMempoolScanCursor },
  );
  const storeMempoolScanState = isolatedFunction(
    BACKFILL_PATH,
    "storeMempoolScanState",
    { normalizedMempoolScanCursor },
  );
  const txid = "1".repeat(64);
  const legacy = await mempoolScanState({
    async query(_sql, params) {
      assert.deepEqual(Array.from(params), ["mempoolScan:livenet"]);
      return { rows: [{ value: { processedTxids: [txid] } }] };
    },
  });
  assert.equal(legacy.cursor, null);
  assert.equal(legacy.priorityCursor, null);
  assert.deepEqual(Array.from(legacy.processedTxids), [txid]);

  let storedPayload = null;
  await storeMempoolScanState(
    {
      async query(sql, params) {
        assert.match(String(sql), /INSERT INTO proof_indexer\.meta/u);
        assert.equal(params[0], "mempoolScan:livenet");
        storedPayload = JSON.parse(params[1]);
        return { rows: [] };
      },
    },
    legacy.key,
    Array.from(legacy.processedTxids),
    legacy.cursor,
    legacy.priorityCursor,
  );
  assert.equal(storedPayload.cursor, null);
  assert.equal(storedPayload.priorityCursor, null);
  assert.deepEqual(storedPayload.processedTxids, [txid]);
  assert.ok(Number.isFinite(Date.parse(storedPayload.scannedAt)));

  const reloaded = await mempoolScanState({
    async query() {
      return { rows: [{ value: storedPayload }] };
    },
  });
  assert.equal(reloaded.cursor, null);
  assert.equal(reloaded.priorityCursor, null);
  assert.deepEqual(Array.from(reloaded.processedTxids), [txid]);
});

check("mempool priority cursor rotates unresolved rows and persists independently", async () => {
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const normalizedMempoolScanCursor = isolatedFunction(
    BACKFILL_PATH,
    "normalizedMempoolScanCursor",
    { isHexTxid },
  );
  const mempoolEntriesAfterCursor = isolatedFunction(
    BACKFILL_PATH,
    "mempoolEntriesAfterCursor",
    { normalizedMempoolScanCursor },
  );
  const plannedMempoolScanCandidates = isolatedFunction(
    BACKFILL_PATH,
    "plannedMempoolScanCandidates",
    { isHexTxid, mempoolEntriesAfterCursor },
  );
  const mempoolScanState = isolatedFunction(
    BACKFILL_PATH,
    "mempoolScanState",
    { NETWORK: "livenet", normalizedMempoolScanCursor },
  );
  const storeMempoolScanState = isolatedFunction(
    BACKFILL_PATH,
    "storeMempoolScanState",
    { normalizedMempoolScanCursor },
  );
  const txid = (index) => index.toString(16).padStart(64, "0");
  const priorityTxids = Array.from(
    { length: 6 },
    (_value, index) => txid(index + 1),
  );
  const routineTxid = txid(100);
  const entries = [...priorityTxids, routineTxid].map((entryTxid, index) => [
    entryTxid,
    { time: 1_000 - index },
  ]);
  const processedTxids = new Set(priorityTxids);
  const first = plannedMempoolScanCandidates(
    entries,
    { cursor: null, priorityCursor: null, processedTxids },
    priorityTxids,
    { candidateLimit: 5, seenLimit: 100 },
  );
  assert.equal(first[0].lane, "cursor");
  assert.equal(first[0].entry[0], routineTxid);
  assert.deepEqual(
    Array.from(
      first.filter((candidate) => candidate.lane === "priority"),
      (candidate) => candidate.entry[0],
    ),
    priorityTxids.slice(0, 4),
  );

  const cursor = normalizedMempoolScanCursor({
    time: first[0].entry[1].time,
    txid: first[0].entry[0],
  });
  const lastPriority = first.filter(
    (candidate) => candidate.lane === "priority",
  ).at(-1).entry;
  const priorityCursor = normalizedMempoolScanCursor({
    time: lastPriority[1].time,
    txid: lastPriority[0],
  });
  let storedPayload = null;
  const client = {
    async query(_sql, params) {
      if (params?.length === 2) {
        storedPayload = JSON.parse(params[1]);
        return { rows: [] };
      }
      return { rows: [{ value: storedPayload }] };
    },
  };
  await storeMempoolScanState(
    client,
    "mempoolScan:livenet",
    [...priorityTxids, routineTxid],
    cursor,
    priorityCursor,
  );
  const reloaded = await mempoolScanState(client);
  assert.equal(reloaded.cursor.txid, cursor.txid);
  assert.equal(reloaded.cursor.time, cursor.time);
  assert.equal(reloaded.priorityCursor.txid, priorityCursor.txid);
  assert.equal(reloaded.priorityCursor.time, priorityCursor.time);

  const second = plannedMempoolScanCandidates(
    entries,
    reloaded,
    priorityTxids,
    { candidateLimit: 5, seenLimit: 100 },
  );
  assert.deepEqual(
    Array.from(
      second.filter((candidate) => candidate.lane === "priority"),
      (candidate) => candidate.entry[0],
    ),
    [priorityTxids[4], priorityTxids[5], priorityTxids[0], priorityTxids[1]],
  );
});

check("fresh mempool candidate reads bypass the process transaction cache", async () => {
  const txid = "2".repeat(64);
  const calls = [];
  const freshRawTransactionFromCore = isolatedFunction(
    BACKFILL_PATH,
    "freshRawTransactionFromCore",
    {
      BITCOIN_RPC_URL: "http://127.0.0.1:8332",
      bitcoinRpc: async (method, params) => {
        calls.push([method, params]);
        return { txid, vin: [], vout: [] };
      },
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
    },
  );
  assert.equal((await freshRawTransactionFromCore(txid)).txid, txid);
  assert.equal((await freshRawTransactionFromCore(txid)).txid, txid);
  assert.deepEqual(
    Array.from(calls, ([method, params]) => [method, Array.from(params)]),
    [
      ["getrawtransaction", [txid, true]],
      ["getrawtransaction", [txid, true]],
    ],
  );
});

check("saturated recovery lanes reserve finite cursor progress without duplicates", () => {
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const normalizedMempoolScanCursor = isolatedFunction(
    BACKFILL_PATH,
    "normalizedMempoolScanCursor",
    { isHexTxid },
  );
  const mempoolEntriesAfterCursor = isolatedFunction(
    BACKFILL_PATH,
    "mempoolEntriesAfterCursor",
    { normalizedMempoolScanCursor },
  );
  const plannedMempoolScanCandidates = isolatedFunction(
    BACKFILL_PATH,
    "plannedMempoolScanCandidates",
    { isHexTxid, mempoolEntriesAfterCursor },
  );
  const txid = (index) => index.toString(16).padStart(64, "0");
  const priorityTxids = Array.from({ length: 6 }, (_value, index) => txid(index + 1));
  const routineTxids = Array.from({ length: 4 }, (_value, index) => txid(index + 100));
  const entries = [...priorityTxids, ...routineTxids].map((entryTxid, index) => [
    entryTxid,
    { time: 1_000 - index },
  ]);
  const processedTxids = new Set(priorityTxids);
  let cursor = null;
  const cursorOrder = [];

  for (let cycle = 0; cycle < routineTxids.length; cycle += 1) {
    const candidates = plannedMempoolScanCandidates(
      entries,
      { cursor, processedTxids },
      [...priorityTxids, priorityTxids[0]],
      { candidateLimit: 5, seenLimit: 100 },
    );
    const candidateTxids = Array.from(
      candidates,
      (candidate) => candidate.entry[0],
    );
    assert.equal(candidates.length, 5);
    assert.equal(new Set(candidateTxids).size, candidates.length);
    assert.equal(candidates[0].lane, "cursor");
    assert.equal(
      candidates.filter((candidate) => candidate.lane === "priority").length,
      4,
    );
    cursor = normalizedMempoolScanCursor({
      time: candidates[0].entry[1].time,
      txid: candidates[0].entry[0],
    });
    cursorOrder.push(cursor.txid);
    processedTxids.add(cursor.txid);
  }
  assert.deepEqual(cursorOrder, routineTxids);
});

check("mempool scan prioritizes Core-present rows with missing events", async () => {
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const normalizedMempoolScanCursor = isolatedFunction(
    BACKFILL_PATH,
    "normalizedMempoolScanCursor",
    { isHexTxid },
  );
  const mempoolEntriesAfterCursor = isolatedFunction(
    BACKFILL_PATH,
    "mempoolEntriesAfterCursor",
    { normalizedMempoolScanCursor },
  );
  const plannedMempoolScanCandidates = isolatedFunction(
    BACKFILL_PATH,
    "plannedMempoolScanCandidates",
    { isHexTxid, mempoolEntriesAfterCursor },
  );
  const mempoolRecoveryTxidsFromRows = isolatedFunction(
    BACKFILL_PATH,
    "mempoolRecoveryTxidsFromRows",
    {
      isHexTxid,
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_TOKEN_MINT_AMOUNT: 1_000,
    },
  );
  const knownMempoolRecoveryTxids = isolatedFunction(
    BACKFILL_PATH,
    "knownMempoolRecoveryTxids",
    {
      isHexTxid,
      mempoolRecoveryTxidsFromRows,
      NETWORK: "livenet",
      WORK_TOKEN_ID: "work-token-id",
      WORK_TOKEN_MINT_AMOUNT: 1_000,
    },
  );
  const target = "a".repeat(64);
  const absent = "b".repeat(64);
  let recoverySql = "";
  let recoveryParams = null;
  const priorityTxids = await knownMempoolRecoveryTxids(
    {
      async query(sql, params) {
        recoverySql = String(sql);
        recoveryParams = params;
        return {
          rows: [target, absent].map((txid) => ({
            attempted_mints: 0,
            confirmed_supply: 20_999_000,
            event_count: 0,
            inspection_version: 1,
            invalid_decisions: 0,
            protocol_resolved_invalid: false,
            recovery_needed: false,
            resolved_invalid: false,
            status: "pending",
            txid,
            valid_decisions: 0,
          })),
        };
      },
    },
    { [target]: { time: 1 } },
  );
  assert.deepEqual(Array.from(priorityTxids), [target]);
  assert.match(
    recoverySql,
    /t\.status IN \('pending', 'dropped', 'orphaned'\)/u,
  );
  assert.match(
    recoverySql,
    /count\(e\.event_id\)::integer AS event_count/u,
  );
  assert.match(
    recoverySql,
    /pendingWorkMintInspectionVersion[\s\S]*AS inspection_version[\s\S]*pendingWorkMintAttemptCount[\s\S]*AS attempted_mints[\s\S]*pendingWorkMintRecoveryNeeded[\s\S]*AS recovery_needed[\s\S]*pendingWorkMintResolvedInvalid[\s\S]*AS resolved_invalid[\s\S]*pendingProtocolResolvedInvalid[\s\S]*AS protocol_resolved_invalid/u,
  );
  assert.deepEqual(Array.from(recoveryParams), [
    "livenet",
    "work-token-id",
    1_000,
  ]);

  const row = (
    txid,
    {
      attemptedMints = 1,
      eventCount = 1,
      inspectionVersion = 1,
      invalidDecisions = 0,
      protocolResolvedInvalid = false,
      recoveryNeeded = false,
      resolvedInvalid = false,
      status = "pending",
      validDecisions = 0,
    } = {},
  ) => ({
    attempted_mints: attemptedMints,
    confirmed_supply: 20_999_000,
    event_count: eventCount,
    inspection_version: inspectionVersion,
    invalid_decisions: invalidDecisions,
    protocol_resolved_invalid: protocolResolvedInvalid,
    recovery_needed: recoveryNeeded,
    resolved_invalid: resolvedInvalid,
    status,
    txid,
    valid_decisions: validDecisions,
  });
  const lower = "1".repeat(64);
  const higher = "2".repeat(64);
  assert.deepEqual(
    Array.from(
      mempoolRecoveryTxidsFromRows(
        [
          row(lower, { validDecisions: 1 }),
          row(higher, { invalidDecisions: 1 }),
        ],
        { [higher]: {} },
      ),
    ),
    [higher],
    "A Core-absent lower txid must not consume the available slot.",
  );
  assert.deepEqual(
    Array.from(
      mempoolRecoveryTxidsFromRows(
        [
          row(lower, { validDecisions: 1 }),
          row(higher, { invalidDecisions: 1 }),
        ],
        { [lower]: {}, [higher]: {} },
      ),
    ),
    [],
  );
  assert.deepEqual(
    new Set(
      mempoolRecoveryTxidsFromRows(
        [
          row(lower, { invalidDecisions: 1 }),
          row(higher, { validDecisions: 1 }),
        ],
        { [lower]: {}, [higher]: {} },
      ),
    ),
    new Set([lower, higher]),
  );
  const missing = "3".repeat(64);
  const revived = "4".repeat(64);
  const multi = "5".repeat(64);
  const permanentInvalid = "6".repeat(64);
  const terminalProtocolInvalid = "f".repeat(64);
  assert.deepEqual(
    new Set(
      mempoolRecoveryTxidsFromRows(
        [
          row(missing, { attemptedMints: 0, eventCount: 0 }),
          row(revived, {
            attemptedMints: 0,
            eventCount: 1,
            status: "dropped",
          }),
          row(multi, { attemptedMints: 2, validDecisions: 1 }),
          row(permanentInvalid, { attemptedMints: 0 }),
          row(terminalProtocolInvalid, {
            attemptedMints: 0,
            eventCount: 0,
            protocolResolvedInvalid: true,
          }),
        ],
        {
          [missing]: {},
          [multi]: {},
          [permanentInvalid]: {},
          [revived]: {},
          [terminalProtocolInvalid]: {},
        },
      ),
    ),
    new Set([missing, revived, multi]),
  );
  const lowerMulti = row(lower, {
    attemptedMints: 2,
    validDecisions: 1,
  });
  const laterInvalid = row(higher, { invalidDecisions: 1 });
  lowerMulti.confirmed_supply = 20_998_000;
  laterInvalid.confirmed_supply = 20_998_000;
  assert.deepEqual(
    new Set(
      mempoolRecoveryTxidsFromRows(
        [lowerMulti, laterInvalid],
        { [lower]: {}, [higher]: {} },
      ),
    ),
    new Set([lower, higher]),
    "A multi-mint row must not hide a later decision by consuming unproven slots.",
  );
  const partial = "7".repeat(64);
  const afterPartial = "8".repeat(64);
  assert.deepEqual(
    new Set(
      mempoolRecoveryTxidsFromRows(
        [
          row(partial, {
            attemptedMints: 1,
            eventCount: 1,
            recoveryNeeded: true,
          }),
          row(afterPartial, { invalidDecisions: 1 }),
        ],
        { [partial]: {}, [afterPartial]: {} },
      ),
    ),
    new Set([partial, afterPartial]),
    "A persisted sibling event must not hide a deferred WORK decision or later ordering.",
  );
  const legacy = "9".repeat(64);
  const inspectedNonWork = "a".repeat(63) + "b";
  assert.deepEqual(
    Array.from(
      mempoolRecoveryTxidsFromRows(
        [
          row(legacy, {
            attemptedMints: 0,
            inspectionVersion: 0,
          }),
          row(inspectedNonWork, { attemptedMints: 0 }),
        ],
        { [legacy]: {}, [inspectedNonWork]: {} },
      ),
    ),
    [legacy],
    "Legacy pending rows must receive one versioned protocol inspection.",
  );
  assert.deepEqual(
    Array.from(
      mempoolRecoveryTxidsFromRows(
        [row(legacy, {
          attemptedMints: 0,
          inspectionVersion: 0,
          validDecisions: 1,
        })],
        { [legacy]: {} },
      ),
    ),
    [legacy],
    "An unversioned decision must be inspected once for hidden multi-mint attempts.",
  );
  const resolvedInvalid = "d".repeat(64);
  assert.deepEqual(
    Array.from(
      mempoolRecoveryTxidsFromRows(
        [row(resolvedInvalid, {
          attemptedMints: 1,
          eventCount: 0,
          resolvedInvalid: true,
        })],
        { [resolvedInvalid]: {} },
      ),
    ),
    [],
    "A versioned permanent-invalid decision must not churn after delete-only reconciliation.",
  );

  const routine = "c".repeat(64);
  const candidates = plannedMempoolScanCandidates(
    [
      [routine, { time: 2 }],
      [target, { time: 1 }],
    ],
    { cursor: null, processedTxids: new Set([target]) },
    priorityTxids,
    { candidateLimit: 2, seenLimit: 100 },
  );
  assert.equal(candidates[0].entry[0], routine);
  assert.equal(candidates[0].lane, "cursor");
  assert.equal(candidates[1].entry[0], target);
  assert.equal(candidates[1].lane, "priority");
  assert.equal(
    candidates.filter((candidate) => candidate.entry[0] === target).length,
    1,
  );
});

check("pending WORK inspection survives a persisted sibling envelope", async () => {
  const workTokenId =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const txid = "b".repeat(64);
  const pendingWorkMintVerifierResolved = isolatedFunction(
    BACKFILL_PATH,
    "pendingWorkMintVerifierResolved",
    { WORK_TOKEN_ID: workTokenId },
  );
  const pendingProtocolTransactionObservation = isolatedFunction(
    BACKFILL_PATH,
    "pendingProtocolTransactionObservation",
  );
  const pendingCoreMarketplaceVerifierNeeded = isolatedFunction(
    BACKFILL_PATH,
    "pendingCoreMarketplaceVerifierNeeded",
  );
  const storePendingWorkMintInspection = isolatedFunction(
    BACKFILL_PATH,
    "storePendingWorkMintInspection",
    { NETWORK: "livenet" },
  );
  const storePendingWorkMintAttemptPreinspection = isolatedFunction(
    BACKFILL_PATH,
    "storePendingWorkMintAttemptPreinspection",
    { NETWORK: "livenet" },
  );
  const siblingEnvelope = [{
    item: {
      kind: "mail-envelope",
      protocol: "pwm1",
      txid,
      valid: true,
    },
  }];
  assert.equal(
    pendingCoreMarketplaceVerifierNeeded([
      { prefix: "pwt1:", text: "pwt1:delist5:listing" },
    ]),
    true,
  );
  assert.equal(
    pendingCoreMarketplaceVerifierNeeded([
      { prefix: "pwt1:", text: `pwt1:mint:${workTokenId}:1000` },
      { prefix: "pwm1:", text: "pwm1:m:hello" },
    ]),
    false,
  );
  assert.equal(pendingWorkMintVerifierResolved(siblingEnvelope), false);
  assert.equal(
    pendingWorkMintVerifierResolved([
      ...siblingEnvelope,
      {
        item: {
          kind: "token-mint",
          tokenId: workTokenId,
          txid,
          valid: true,
        },
      },
    ]),
    true,
  );
  const observation = pendingProtocolTransactionObservation(
    txid,
    1,
    true,
    false,
  );
  assert.equal(observation.pendingWorkMintAttemptCount, 1);
  assert.equal(observation.pendingWorkMintInspectionVersion, 1);
  assert.equal(observation.pendingWorkMintRecoveryNeeded, true);
  assert.equal(observation.pendingWorkMintResolvedInvalid, false);
  assert.equal(observation.status, "pending");

  let inspectionWrite = null;
  await storePendingWorkMintInspection(
    {
      async query(sql, params) {
        inspectionWrite = { params, sql: String(sql) };
        return { rowCount: 1, rows: [{ txid }] };
      },
    },
    txid,
    1,
    true,
    false,
    true,
  );
  assert.match(
    inspectionWrite.sql,
    /pendingWorkMintAttemptCount[\s\S]*pendingWorkMintInspectionVersion[\s\S]*pendingWorkMintRecoveryNeeded[\s\S]*pendingWorkMintResolvedInvalid[\s\S]*pendingProtocolResolvedInvalid/u,
  );
  assert.match(inspectionWrite.sql, /t\.status = 'pending'/u);
  assert.match(inspectionWrite.sql, /canonicalBlockScan/u);
  assert.deepEqual(Array.from(inspectionWrite.params), [
    "livenet",
    txid,
    1,
    true,
    false,
    true,
  ]);
  let preinspectionWrite = null;
  assert.equal(
    await storePendingWorkMintAttemptPreinspection(
      {
        async query(sql, params) {
          preinspectionWrite = { params, sql: String(sql) };
          return { rowCount: 1, rows: [{ txid }] };
        },
      },
      txid,
      2,
    ),
    1,
  );
  assert.match(
    preinspectionWrite.sql,
    /pendingWorkMintAttemptCount[\s\S]*pendingWorkMintInspectionVersion[\s\S]*pendingWorkMintRecoveryNeeded'[\s\S]*true[\s\S]*pendingWorkMintResolvedInvalid'[\s\S]*false/u,
  );
  assert.match(
    preinspectionWrite.sql,
    /pendingWorkMintInspectionVersion'[\s\S]*!~ '\^\[1-9\]\[0-9\]\*\$'/u,
  );
  assert.deepEqual(Array.from(preinspectionWrite.params), [
    "livenet",
    txid,
    2,
  ]);
});

check("Core-present dropped protocol transactions revive through verifier and upsert", async () => {
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const normalizedMempoolScanCursor = isolatedFunction(
    BACKFILL_PATH,
    "normalizedMempoolScanCursor",
    { isHexTxid },
  );
  const mempoolScanCursorForEntry = isolatedFunction(
    BACKFILL_PATH,
    "mempoolScanCursorForEntry",
    { normalizedMempoolScanCursor },
  );
  const mempoolEntriesAfterCursor = isolatedFunction(
    BACKFILL_PATH,
    "mempoolEntriesAfterCursor",
    { normalizedMempoolScanCursor },
  );
  const plannedMempoolScanCandidates = isolatedFunction(
    BACKFILL_PATH,
    "plannedMempoolScanCandidates",
    { isHexTxid, mempoolEntriesAfterCursor },
  );
  const transactionHasConfirmedBlockEvidence = isolatedFunction(
    BACKFILL_PATH,
    "transactionHasConfirmedBlockEvidence",
    { isHexTxid },
  );
  const pendingTransactionObservationItem = isolatedFunction(
    BACKFILL_PATH,
    "pendingTransactionObservationItem",
  );
  const upsertTransaction = isolatedFunction(
    BACKFILL_PATH,
    "upsertTransaction",
    {
      NETWORK: "livenet",
      itemTime: (item) => item.createdAt,
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
    },
  );
  const target = "d".repeat(64);
  const firstSeenAt = "2026-07-14T18:00:00.000Z";
  let projectionCalls = 0;
  const upsertEvent = isolatedFunction(
    BACKFILL_PATH,
    "upsertEvent",
    {
      NETWORK: "livenet",
      amountSats: () => 0,
      dataBytes: () => 0,
      eventKind: (item) => item.kind,
      itemStatus: (item) => item.status ?? (
        item.confirmed === false ? "pending" : "confirmed"
      ),
      itemTime: (item) => item.createdAt,
      itemTxid: (item) => item.txid,
      normalizedEventItem: (item) => item,
      numberOrNull: (value) => (
        Number.isFinite(Number(value)) ? Number(value) : null
      ),
      participantsForItem: () => [],
      protocolForItem: () => "pwid1",
      refsForItem: () => [],
      stableEventKey: ({ kind, txid }) => `${kind}:${txid}`,
      stableEventKeyKind: (_item, kind) => kind,
      upsertProjection: async () => {
        projectionCalls += 1;
      },
      upsertTransaction,
    },
  );
  let verifierCalls = 0;
  let databaseCanonical = false;
  let storedState = null;
  const pendingTransaction = { txid: target, vin: [], vout: [] };
  const confirmedTransaction = {
    ...pendingTransaction,
    blockhash: "e".repeat(64),
    confirmations: 1,
  };
  let freshTransactions = [];
  let freshReadCount = 0;
  const statements = [];
  const client = {
    async query(sql, params) {
      const text = String(sql);
      statements.push({ params, sql: text });
      if (/INSERT INTO proof_indexer\.events/iu.test(text)) {
        return {
          rowCount: 1,
          rows: [{
            event_id: "revived-event",
            payload: JSON.parse(params[14]),
            status: params[5],
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const backfillMempoolScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillMempoolScanSource",
    {
      BITCOIN_RPC_URL: "http://127.0.0.1:8332",
      MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS: 5,
      MEMPOOL_SCAN_MAX_TXIDS: 500,
      MEMPOOL_SCAN_SEEN_LIMIT: 10_000,
      PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
      bitcoinRpc: async () => ({ [target]: { time: 1_720_980_000 } }),
      freshRawTransactionFromCore: async (txid) => {
        assert.equal(txid, target);
        freshReadCount += 1;
        assert.ok(
          freshTransactions.length > 0,
          "Every persistence boundary must consume an explicit fresh Core read",
        );
        return freshTransactions.shift();
      },
      isHexTxid,
      knownMempoolRecoveryTxids: async () => [target],
      mempoolScanCursorForEntry,
      mempoolScanState: async () => ({
        cursor: null,
        key: "mempoolScan:livenet",
        priorityCursor: null,
        processedTxids: new Set([target]),
      }),
      plannedMempoolScanCandidates,
      pendingProtocolTransactionObservation: () => ({
        confirmed: false,
        status: "pending",
        txid: target,
      }),
      pendingCoreMarketplaceVerifierNeeded: () => false,
      pendingWorkMintDecision: () => null,
      pendingWorkMintAttemptCount: () => 0,
      pendingWorkMintVerifierResolved: () => true,
      pendingTransactionWriteItem: (prepared, txid) => ({
        ...(prepared[0]?.item ?? {}),
        confirmed: false,
        dropped: false,
        status: "pending",
        txid,
      }),
      lockedCanonicalTransactionForMempool: async () => databaseCanonical,
      reconcilePendingWorkMintDecision: async () => ({
        deleted: 0,
        persistInvalid: false,
        reconciled: false,
      }),
      storePendingWorkMintAttemptPreinspection: async () => 0,
      storePendingWorkMintInspection: async () => {},
      preparedProtocolItemsForTx: async () => {
        verifierCalls += 1;
        return [{
          item: {
            confirmed: false,
            createdAt: firstSeenAt,
            id: "revived",
            kind: "id-register",
            txid: target,
            valid: true,
          },
          sourceLabel: "registry-records",
        }];
      },
      protocolMessagesFromTx: () => [
        { prefix: "pwid1:", text: "pwid1:r2:cmV2aXZlZA:owner:owner" },
      ],
      storeMempoolScanState: async (
        _client,
        key,
        processedTxids,
        cursor,
        priorityCursor,
      ) => {
        storedState = { cursor, key, priorityCursor, processedTxids };
      },
      transactionHasConfirmedBlockEvidence,
      transactionWithInputPrevouts: async (tx) => tx,
      upsertTransaction,
      persistPreparedProtocolItems: async (_client, prepared) => {
        const item = prepared[0].item;
        await upsertEvent(client, "registry-records", item);
        return { indexed: 1, skipped: 0 };
      },
    },
  );
  freshTransactions = [
    pendingTransaction,
    pendingTransaction,
    pendingTransaction,
  ];
  const result = await backfillMempoolScanSource(client, {
    label: "mempool-scan",
  });
  assert.equal(verifierCalls, 1);
  assert.equal(freshReadCount, 3);
  assert.equal(result.indexed, 1);
  assert.equal(result.priorityScanned, 1);
  assert.equal(result.unresolved, 0);
  assert.deepEqual(Array.from(storedState.processedTxids), [target]);
  assert.equal(storedState.cursor, null);
  assert.equal(storedState.priorityCursor.time, 1_720_980_000);
  assert.equal(storedState.priorityCursor.txid, target);

  const transactionUpsert = statements.find(({ sql }) =>
    /INSERT INTO proof_indexer\.transactions/iu.test(sql),
  );
  assert.equal(transactionUpsert.params[2], "pending");
  assert.match(transactionUpsert.sql, /ELSE EXCLUDED\.status/u);
  assert.match(transactionUpsert.sql, /dropped_at = CASE[\s\S]*THEN NULL/u);
  assert.match(transactionUpsert.sql, /dropped_reason = CASE[\s\S]*THEN NULL/u);
  assert.match(transactionUpsert.sql, /replaced_by_txid = CASE[\s\S]*THEN NULL/u);
  assert.match(transactionUpsert.sql, /- 'statusObservation'/u);
  const eventUpsert = statements.find(({ sql }) =>
    /INSERT INTO proof_indexer\.events/iu.test(sql),
  );
  assert.equal(eventUpsert.params[2], target);
  assert.equal(eventUpsert.params[4], "id-register");
  assert.equal(eventUpsert.params[5], "pending");
  assert.match(
    eventUpsert.sql,
    /ON CONFLICT \(network, event_key\)[\s\S]*status = EXCLUDED\.status/u,
  );
  assert.equal(projectionCalls, 1);

  const beforeWriteStatementCount = statements.length;
  freshTransactions = [pendingTransaction, confirmedTransaction];
  const beforeWriteVerifierCalls = verifierCalls;
  const beforeWriteRace = await backfillMempoolScanSource(client, {
    label: "mempool-scan",
  });
  assert.equal(beforeWriteRace.canonicalDeferred, 1);
  assert.equal(beforeWriteRace.indexed, 0);
  assert.equal(beforeWriteRace.unresolved, 0);
  assert.equal(verifierCalls, beforeWriteVerifierCalls + 1);
  assert.equal(statements.length, beforeWriteStatementCount);

  const beforeCommitStatementCount = statements.length;
  freshTransactions = [
    pendingTransaction,
    pendingTransaction,
    confirmedTransaction,
  ];
  const beforeCommitVerifierCalls = verifierCalls;
  const beforeCommitRace = await backfillMempoolScanSource(client, {
    label: "mempool-scan",
  });
  assert.equal(beforeCommitRace.canonicalDeferred, 1);
  assert.equal(beforeCommitRace.indexed, 0);
  assert.equal(beforeCommitRace.unresolved, 0);
  assert.equal(verifierCalls, beforeCommitVerifierCalls + 1);
  const rolledBackStatements = statements.slice(beforeCommitStatementCount);
  assert.equal(rolledBackStatements[0].sql, "BEGIN");
  assert.ok(rolledBackStatements.some(({ sql }) =>
    /INSERT INTO proof_indexer\.events/iu.test(sql)
  ));
  assert.equal(rolledBackStatements.at(-1).sql, "ROLLBACK");
  assert.equal(
    rolledBackStatements.some(({ sql }) => sql === "COMMIT"),
    false,
  );

  const initialStatementCount = statements.length;
  freshTransactions = [confirmedTransaction];
  const initialVerifierCalls = verifierCalls;
  const initialRace = await backfillMempoolScanSource(client, {
    label: "mempool-scan",
  });
  assert.equal(initialRace.canonicalDeferred, 1);
  assert.equal(initialRace.indexed, 0);
  assert.equal(verifierCalls, initialVerifierCalls);
  assert.equal(statements.length, initialStatementCount);

  const databaseRaceStatementCount = statements.length;
  databaseCanonical = true;
  freshTransactions = [pendingTransaction, pendingTransaction];
  const databaseRace = await backfillMempoolScanSource(client, {
    label: "mempool-scan",
  });
  assert.equal(databaseRace.canonicalDeferred, 1);
  assert.equal(databaseRace.indexed, 0);
  assert.equal(databaseRace.unresolved, 0);
  const databaseRaceStatements = statements.slice(databaseRaceStatementCount);
  assert.equal(databaseRaceStatements[0].sql, "BEGIN");
  assert.ok(databaseRaceStatements.some(({ sql }) =>
    /INSERT INTO proof_indexer\.transactions/iu.test(sql)
  ));
  assert.equal(databaseRaceStatements.at(-1).sql, "ROLLBACK");
  assert.equal(
    databaseRaceStatements.some(({ sql }) =>
      /INSERT INTO proof_indexer\.events/iu.test(sql)
    ),
    false,
  );
  databaseCanonical = false;
});

check("supply-capped mempool mints replace stale valid rows with a pending invalid audit", async () => {
  const target = "f".repeat(64);
  const workTokenId =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const pendingTransaction = { txid: target, vin: [], vout: [] };
  const pendingTransactionObservationItem = isolatedFunction(
    BACKFILL_PATH,
    "pendingTransactionObservationItem",
  );
  const pendingTransactionWriteItem = isolatedFunction(
    BACKFILL_PATH,
    "pendingTransactionWriteItem",
    { pendingTransactionObservationItem },
  );
  const upsertTransaction = isolatedFunction(
    BACKFILL_PATH,
    "upsertTransaction",
    {
      NETWORK: "livenet",
      itemTime: (item) => item.createdAt,
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
    },
  );
  const pendingWorkMintDecision = isolatedFunction(
    BACKFILL_PATH,
    "pendingWorkMintDecision",
    { WORK_TOKEN_ID: workTokenId },
  );
  const reconcilePendingWorkMintDecision = isolatedFunction(
    BACKFILL_PATH,
    "reconcilePendingWorkMintDecision",
    {
      NETWORK: "livenet",
      WORK_TOKEN_ID: workTokenId,
      pendingWorkMintDecision,
    },
  );
  const trace = [];
  const statements = [];
  let persistedPrepared = null;
  let storedState = null;
  let freshReads = 0;
  const client = {
    async query(sql, params) {
      const text = String(sql).trim();
      trace.push(text === "BEGIN" || text === "COMMIT" ? text : "sql");
      statements.push({ params, sql: text });
      if (/WITH canonical_guard AS/iu.test(text)) {
        return {
          rowCount: 1,
          rows: [{ canonical_confirmed: false, deleted: 1 }],
        };
      }
      if (/FOR UPDATE/iu.test(text)) {
        return {
          rowCount: 1,
          rows: [{ canonical_confirmed: false, status: "pending" }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const backfillMempoolScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillMempoolScanSource",
    {
      BITCOIN_RPC_URL: "http://127.0.0.1:8332",
      MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS: 5,
      MEMPOOL_SCAN_MAX_TXIDS: 500,
      MEMPOOL_SCAN_SEEN_LIMIT: 10_000,
      PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
      WORK_TOKEN_ID: workTokenId,
      bitcoinRpc: async () => ({ [target]: { time: 1_720_990_000 } }),
      freshRawTransactionFromCore: async () => {
        freshReads += 1;
        trace.push("fresh");
        return pendingTransaction;
      },
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      knownMempoolRecoveryTxids: async () => [target],
      mempoolScanCursorForEntry: ([txid, metadata]) => ({
        time: metadata.time,
        txid,
      }),
      mempoolScanState: async () => ({
        cursor: null,
        key: "mempoolScan:livenet",
        priorityCursor: null,
        processedTxids: new Set([target]),
      }),
      pendingTransactionObservationItem,
      pendingTransactionWriteItem,
      pendingProtocolTransactionObservation: () => ({
        confirmed: false,
        status: "pending",
        txid: target,
      }),
      pendingWorkMintDecision,
      pendingWorkMintAttemptCount: () => 1,
      pendingWorkMintVerifierResolved: () => true,
      lockedCanonicalTransactionForMempool: isolatedFunction(
        BACKFILL_PATH,
        "lockedCanonicalTransactionForMempool",
        { NETWORK: "livenet" },
      ),
      reconcilePendingWorkMintDecision,
      storePendingWorkMintAttemptPreinspection: async () => 1,
      storePendingWorkMintInspection: async () => {},
      persistPreparedProtocolItems: async (_client, prepared) => {
        trace.push(`persist:${prepared.length}`);
        persistedPrepared = prepared;
        return { indexed: 0, skipped: 0 };
      },
      plannedMempoolScanCandidates: (entries) => [{
        entry: entries[0],
        lane: "priority",
      }],
      preparedProtocolItemsForTx: async () => {
        trace.push("verifier");
        return [{
          item: {
            confirmed: false,
            createdAt: "2026-07-15T01:20:00.000Z",
            kind: "token-event-invalid",
            provisionalReason: "supply-cap",
            reason: "WORK mint exceeds max supply.",
            status: "pending",
            tokenId: workTokenId,
            txid: target,
            valid: false,
          },
          sourceLabel: "token-invalid-events",
        }];
      },
      protocolMessagesFromTx: () => [{
        prefix: "pwt1:",
        text: `pwt1:mint:${"a".repeat(64)}:1000`,
      }],
      storeMempoolScanState: async (
        _client,
        key,
        processedTxids,
        cursor,
        priorityCursor,
      ) => {
        trace.push("store");
        storedState = { cursor, key, priorityCursor, processedTxids };
      },
      transactionHasConfirmedBlockEvidence: () => false,
      transactionWithInputPrevouts: async (tx) => tx,
      upsertTransaction: async (...args) => {
        trace.push("upsert");
        return upsertTransaction(...args);
      },
    },
  );

  const result = await backfillMempoolScanSource(client, {
    label: "mempool-scan",
  });
  assert.equal(freshReads, 3);
  assert.equal(result.indexed, 0);
  assert.equal(result.priorityScanned, 1);
  assert.equal(result.unresolved, 0);
  assert.equal(persistedPrepared.length, 1);
  assert.equal(persistedPrepared[0].item.kind, "token-event-invalid");
  assert.equal(persistedPrepared[0].item.valid, false);
  assert.deepEqual(Array.from(storedState.processedTxids), [target]);
  assert.equal(storedState.priorityCursor.txid, target);
  assert.equal(storedState.priorityCursor.time, 1_720_990_000);
  assert.deepEqual(trace, [
    "fresh",
    "verifier",
    "fresh",
    "BEGIN",
    "upsert",
    "sql",
    "sql",
    "sql",
    "persist:1",
    "fresh",
    "COMMIT",
    "store",
  ]);
  const transactionWrite = statements.find(({ sql }) =>
    /INSERT INTO proof_indexer\.transactions/iu.test(sql),
  );
  assert.ok(transactionWrite);
  assert.equal(transactionWrite.params[1], target);
  assert.equal(transactionWrite.params[2], "pending");
  assert.equal(transactionWrite.params[5], "mempool-scan");
  const observed = JSON.parse(transactionWrite.params[6]).item;
  assert.equal(observed.status, "pending");
  assert.equal(observed.confirmed, false);
  assert.equal(observed.dropped, false);
  assert.equal(observed.valid, false);
  const reconciliation = statements.find(({ sql }) =>
    /WITH canonical_guard AS/iu.test(sql),
  );
  assert.ok(reconciliation);
  assert.match(
    reconciliation.sql,
    /e\.status IN \('pending', 'dropped', 'orphaned'\)/u,
  );
  assert.match(
    reconciliation.sql,
    /e\.kind = 'token-mint'[\s\S]*e\.kind = 'token-event-invalid'[\s\S]*provisionalReason'[\s\S]*supply-cap/u,
  );
  assert.equal(reconciliation.params[1], target);
  assert.equal(reconciliation.params[2], workTokenId);
});

check("resolved permanent-invalid WORK rechecks delete stale volatile decisions", async () => {
  const workTokenId =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const txid = "c".repeat(64);
  const pendingWorkMintDecision = isolatedFunction(
    BACKFILL_PATH,
    "pendingWorkMintDecision",
    { WORK_TOKEN_ID: workTokenId },
  );
  const reconcilePendingWorkMintDecision = isolatedFunction(
    BACKFILL_PATH,
    "reconcilePendingWorkMintDecision",
    {
      NETWORK: "livenet",
      WORK_TOKEN_ID: workTokenId,
      pendingWorkMintDecision,
    },
  );
  const prepared = [{
    item: {
      confirmed: false,
      kind: "token-event-invalid",
      reason: "WORK mint payment is incomplete.",
      status: "pending",
      tokenId: workTokenId,
      txid,
      valid: false,
    },
  }];
  assert.equal(
    pendingWorkMintDecision([{
      item: {
        ...prepared[0].item,
        reason: "WORK transfer sender balance is insufficient.",
      },
    }], 0),
    null,
    "An invalid WORK non-mint must never enter mint reconciliation.",
  );
  const decision = pendingWorkMintDecision(prepared, 1);
  assert.equal(decision.kind, "resolved-invalid");
  assert.equal(decision.persistInvalid, false);
  let deleteWrite = null;
  const result = await reconcilePendingWorkMintDecision(
    {
      async query(sql, params) {
        deleteWrite = { params, sql: String(sql) };
        return {
          rowCount: 1,
          rows: [{ canonical_confirmed: false, deleted: 1 }],
        };
      },
    },
    prepared,
    txid,
    1,
  );
  assert.equal(result.deleted, 1);
  assert.equal(result.persistInvalid, false);
  assert.equal(result.reconciled, true);
  assert.match(deleteWrite.sql, /e\.kind = 'token-mint'/u);
  assert.match(deleteWrite.sql, /provisionalReason'[\s\S]*supply-cap/u);
  assert.deepEqual(Array.from(deleteWrite.params), [
    "livenet",
    txid,
    workTokenId,
  ]);
});

check("canonical WORK mint decisions remove only volatile mint audit rows", async () => {
  const txid = "e".repeat(64);
  const workTokenId =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const queries = [];
  const removeVolatileWorkMintDecisionEvents = isolatedFunction(
    BACKFILL_PATH,
    "removeVolatileWorkMintDecisionEvents",
    {
      NETWORK: "livenet",
      WORK_TOKEN_ID: workTokenId,
    },
  );
  const client = {
    async query(sql, params) {
      queries.push({ params, sql: String(sql) });
      return { rowCount: 2, rows: [] };
    },
  };
  assert.equal(
    await removeVolatileWorkMintDecisionEvents(
      client,
      [{
        item: {
          confirmed: true,
          kind: "token-mint",
          tokenId: workTokenId,
          txid,
        },
      }],
      txid,
    ),
    2,
  );
  assert.equal(queries.length, 1);
  assert.deepEqual(Array.from(queries[0].params), [
    "livenet",
    txid,
    workTokenId,
  ]);
  assert.match(
    queries[0].sql,
    /e\.status IN \('pending', 'dropped', 'orphaned'\)/u,
  );
  assert.match(
    queries[0].sql,
    /e\.kind = 'token-mint'[\s\S]*e\.kind = 'token-event-invalid'[\s\S]*provisionalReason'[\s\S]*supply-cap/u,
  );
  assert.doesNotMatch(queries[0].sql, /e\.status = 'confirmed'/u);
  assert.equal(
    await removeVolatileWorkMintDecisionEvents(
      client,
      [{
        item: {
          confirmed: true,
          kind: "token-transfer",
          tokenId: workTokenId,
          txid,
        },
      }],
      txid,
    ),
    0,
  );
  assert.equal(queries.length, 1);
});

check("same-height pending membership versions the canonical Log snapshot", async () => {
  const readerKinds = /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    fileSource(READER_PATH),
  )?.[1];
  const backfillKinds = /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    fileSource(BACKFILL_PATH),
  )?.[1];
  const parseKinds = (source) =>
    [...String(source ?? "").matchAll(/"([^"]+)"/gu)]
      .map((match) => match[1])
      .sort();
  assert.deepEqual(parseKinds(backfillKinds), parseKinds(readerKinds));

  let rows = [
    {
      block_height: 100,
      block_time: "2026-07-14T17:00:00.000Z",
      created_at: "2026-07-14T17:00:00.000Z",
      event_id: "1",
      event_time: "2026-07-14T17:00:00.000Z",
      kind: "mail",
      payload_hash: "1".repeat(32),
      protocol: "pwm1",
      status: "confirmed",
      txid: "1".repeat(64),
      valid: true,
    },
  ];
  let fingerprintSql = "";
  const publicLogRelationalFingerprint = isolatedFunction(
    BACKFILL_PATH,
    "publicLogRelationalFingerprint",
    {
      NETWORK: "livenet",
      PUBLIC_LOG_EVENT_KINDS: new Set(["mail"]),
      createHash,
    },
  );
  const client = {
    async query(sql) {
      fingerprintSql = String(sql);
      return { rows };
    },
  };
  const before = await publicLogRelationalFingerprint(client);
  rows = [
    ...rows,
    {
      block_height: null,
      block_time: null,
      created_at: "2026-07-14T18:00:00.000Z",
      event_id: "2",
      event_time: "2026-07-14T18:00:00.000Z",
      kind: "mail",
      payload_hash: "2".repeat(32),
      protocol: "pwm1",
      status: "pending",
      txid: "2".repeat(64),
      valid: true,
    },
  ];
  const after = await publicLogRelationalFingerprint(client);
  assert.equal(before.count, 1);
  assert.equal(after.count, 2);
  assert.equal(after.pending, 1);
  assert.notEqual(after.hash, before.hash);
  assert.match(fingerprintSql, /md5\(e\.payload::text\)/u);
  assert.doesNotMatch(fingerprintSql, /e\.updated_at/u);

  const runCycleSource = topLevelFunctionSource(WORKER_PATH, "runCycle");
  assert.match(
    runCycleSource,
    /await runBackfillWithRetries\(backfillEnv, runtime\);[\s\S]*const pendingStatus = await refreshPendingStatuses\(pool\);/u,
  );
});

check("an outer ledger height cannot promote embedded history coverage", () => {
  const indexedThroughBlockFromItems = (items) =>
    Math.max(0, ...items.map((item) => Number(item.blockHeight ?? 0))) || null;
  const embeddedHistoryIndexedThroughBlock = isolatedFunction(
    READER_PATH,
    "embeddedHistoryIndexedThroughBlock",
    {
      indexedThroughBlockFromItems,
      safeBlockHeight: (value) => Math.max(0, Number(value) || 0),
    },
  );
  const historyPageFromStoredPayload = isolatedFunction(
    READER_PATH,
    "historyPageFromStoredPayload",
    {
      dateIso: (value) => value,
      embeddedHistoryIndexedThroughBlock,
      historyCursor: (snapshotId, offset) => `${snapshotId}:${offset}`,
      historyItemsMatchingQuery: (items) => items,
      indexedThroughBlockFromItems,
    },
  );
  const page = historyPageFromStoredPayload(
    {
      indexedAt: "2026-07-03T00:00:00.000Z",
      indexedThroughBlock: 120,
      items: [{ blockHeight: 120, txid: "3".repeat(64) }],
      source: "fixture",
    },
    {
      generated_at: "2026-07-11T00:00:00.000Z",
      indexed_through_block: 999,
      snapshot_id: "outer-newer",
    },
    "livenet",
    "transfers",
    { limit: 25, offset: 0, query: "" },
  );
  assert.equal(page.indexedThroughBlock, 120);
});

check("an outer ledger height cannot promote embedded token state", () => {
  const tokenStateWithSnapshotMetadata = isolatedFunction(
    READER_PATH,
    "tokenStateWithSnapshotMetadata",
    {
      assertCanonicalIncbCurrentProjection: () => {},
      dateIso: (value) => value,
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
    },
  );
  const state = tokenStateWithSnapshotMetadata(
    {
      indexedAt: "2026-07-03T00:00:00.000Z",
      indexedThroughBlock: 120,
      source: "embedded",
    },
    {
      generated_at: "2026-07-11T00:00:00.000Z",
      indexed_through_block: 999,
      snapshot_id: "outer-newer",
    },
    "fixture",
  );
  assert.equal(state.indexedThroughBlock, 120);
});

check("the hot worker publishes a fresh canonical summary with conservative coverage", async () => {
  const objectPayload = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const numberOrNull = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  const summaryPayloadConservativeCoverage = isolatedFunction(
    BACKFILL_PATH,
    "summaryPayloadConservativeCoverage",
    { numberOrNull, objectPayload },
  );
  assert.equal(
    summaryPayloadConservativeCoverage(
      { floor: { indexedThroughBlock: 100 }, indexedThroughBlock: 101 },
      "workSummary",
    ),
    100,
  );
  const requiredKeys = [
    "growthSummary",
    "inceptionSummary",
    "infinitySummary",
    "logSummary",
    "marketplaceSummary",
    "tokenSummary",
    "workFloor",
    "workSummary",
  ];
  const publicLogFingerprint = {
    contract: "proof-index-public-log-fingerprint-v1",
    count: 2,
    hash: "f".repeat(64),
    pending: 0,
  };
  const canonicalSummaryCoverage = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryCoverage",
    {
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      summaryPayloadConservativeCoverage,
    },
  );
  const canonicalSummaryAccountingModelsCurrent = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryAccountingModelsCurrent",
    {
      exactWorkNetworkValueSummaryBinding:
        isolatedExactWorkNetworkValueSummaryBinding(),
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_NETWORK_VALUE_ACCOUNTING_MODEL:
        "fixed-incb-issuance-plus-market-flow-v1",
      INCB_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      WORK_TOKEN_ID:
        "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
      WORK_TRANSFER_VALUE_PROJECTION_MODEL:
        "canonical-work-transfer-value-projection-v1",
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
    },
  );
  const currentInceptionActual = {
    attachedWorkIssuanceUnits: 200,
    attachedWorkLiveValueAtSendSats: 200,
    attachmentAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    bondMarketplaceMutationFeeSats: 0,
    bondSaleVolumeSats: 0,
    bondTransferFeeSats: 0,
    confirmedIssuanceUnits: 746,
    directProofIssuanceUnits: 546,
    floorSats: 1,
    frozenFloorSats: 1,
    frozenNetworkValueSats: 746,
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceCheckpointBlockHeight: 957_950,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustSats: 0,
    issuanceFloorSats: 1,
    issuanceNetworkValueSats: 746,
    issuanceValueSnapshotBlockHash: "a".repeat(64),
    issuanceValueSnapshotBlockHeight: 957_949,
    issuanceValueSnapshotCanonicalSummaryHash: "b".repeat(64),
    issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
    issuanceValueSnapshotId: "snapshot-before-bond",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueSats: 42_000_000,
    liveFloorSats: 1,
    liveNetworkValueSats: 746,
    networkValueAccountingModel:
      "fixed-incb-issuance-plus-market-flow-v1",
    networkValueSats: 746,
  };
  assert.equal(canonicalSummaryAccountingModelsCurrent({}), false);
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      inceptionSummary: {
        actualValue: currentInceptionActual,
        networkValueSats: 746,
        stats: { confirmedSupply: 746 },
        token: { stats: { confirmedMints: 1 } },
      },
      workSummary: {
        token: { stats: { confirmedTransfers: 0 } },
        workTransferValueProjection: {
          items: [],
          model: "canonical-work-transfer-value-projection-v1",
        },
      },
      workFloor: exactWorkFloorFixture("4200000000000000", {
          creditMinerFeeAccountingModel:
            "canonical-unique-tx-input-output-v1",
          creditMinerFeeCoverage: {
            complete: true,
            confirmedEvents: 2,
            confirmedTransactions: 1,
            coveredConfirmedEvents: 2,
            coveredConfirmedTransactions: 1,
            missingConfirmedEvents: 0,
            missingConfirmedTransactions: 0,
            missingConfirmedTxids: [],
            source: "proof-indexer-normalized-input-output-totals",
          },
      }),
    }),
    true,
  );
  const summaryFor = (key, height, snapshotId = `full-${height}`) => ({
    indexedThroughBlock: height,
    snapshotId,
    ...(key === "workSummary"
      ? { floor: { indexedThroughBlock: height } }
      : key === "growthSummary" || key === "marketplaceSummary"
        ? { workFloor: { indexedThroughBlock: height } }
        : {}),
  });
  const currentSummaryFor = (key, height, snapshotId = `full-${height}`) => {
    const payload = summaryFor(key, height, snapshotId);
    if (key === "workFloor") {
      Object.assign(payload, exactWorkFloorFixture("4200000000000000", {
        creditMinerFeeAccountingModel:
          "canonical-unique-tx-input-output-v1",
        creditMinerFeeCoverage: {
          complete: true,
          confirmedEvents: 2,
          confirmedTransactions: 1,
          coveredConfirmedEvents: 2,
          coveredConfirmedTransactions: 1,
          missingConfirmedEvents: 0,
          missingConfirmedTransactions: 0,
          missingConfirmedTxids: [],
          source: "proof-indexer-normalized-input-output-totals",
        },
      }));
    }
    if (key === "inceptionSummary") {
      payload.actualValue = currentInceptionActual;
      payload.networkValueSats = 746;
      payload.stats = { confirmedSupply: 746 };
      payload.token = { stats: { confirmedMints: 1 } };
    }
    if (key === "workSummary") {
      payload.token = { stats: { confirmedTransfers: 0 } };
      payload.workTransferValueProjection = {
        items: [],
        model: "canonical-work-transfer-value-projection-v1",
      };
    }
    if (key === "logSummary") {
      payload.stats = { pending: 0, total: 2 };
      payload.totalCount = 2;
    }
    return payload;
  };
  let previousPayload = {
    ok: true,
    snapshotId: "full-101-legacy-models",
    status: "consistent",
    summaryPayloads: Object.fromEntries(
      requiredKeys.map((key) => [key, summaryFor(key, 101)]),
    ),
  };
  const inserted = [];
  const storeCanonicalSummarySnapshot = isolatedFunction(
    BACKFILL_PATH,
    "storeCanonicalSummarySnapshot",
    {
      NETWORK: "livenet",
      SUMMARY_SNAPSHOT_SOURCES: [
        { key: "unused", path: "/unused" },
      ],
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 600_000,
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      canonicalSummaryAccountingModelsCurrent,
      canonicalSummaryCoverage,
      createHash,
      latestBlockScanCheckpoint: async () => ({ height: 101 }),
      numberOrNull,
      objectPayload,
      publicLogRelationalFingerprint: async () => publicLogFingerprint,
      publicLogFingerprintsMatch: (left, right) =>
        left?.hash === right?.hash &&
        left?.count === right?.count &&
        left?.pending === right?.pending,
      pruneLedgerSnapshots: async () => ({
        canonicalSummaries: 0,
        scanOrDerived: 0,
        total: 0,
      }),
      readJson: async (url, options) => {
        assert.equal(url.pathname, "/api/v1/internal/canonical-summary");
        assert.equal(options.retries, 0);
        assert.equal(options.timeoutMs, 600_000);
        return {
          indexedThroughBlock: 101,
          ledger: {
            checks: [{ name: "ledger-covers-node-tip", ok: true }],
            indexedThroughBlock: 101,
            metrics: { indexedThroughBlock: 101 },
            ok: true,
            snapshotId: "full-101",
            status: "consistent",
            tokenState: { indexedThroughBlock: 101, marker: "canonical" },
          },
          snapshotId: "full-101",
          summaryPayloads: Object.fromEntries(
            requiredKeys.map((key) => [key, currentSummaryFor(key, 101)]),
          ),
        };
      },
      storedEligibleCanonicalSummarySnapshotPayload: async () =>
        previousPayload,
      storedLedgerSnapshotPayload: async (_client, snapshotId) => ({
        activityPayload: { marker: `derived-${snapshotId}` },
      }),
      summaryPayloadSnapshotId: (payload) => String(payload?.snapshotId ?? ""),
      summaryPayloadsWithAlignedWorkFloor: (payload) => payload,
      summarySnapshotTotals: (payloads) =>
        exactSummaryTotalsFixture(payloads.workFloor.networkValueQ8),
      unpagedEndpoint: (pathname) => ({ pathname }),
    },
  );
  const result = await storeCanonicalSummarySnapshot({
    async query(sql, params) {
      inserted.push({ params: Array.from(params), sql: String(sql) });
      return { rows: [] };
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.indexedThroughBlock, 101);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].params[3], 101);
  const stored = JSON.parse(inserted[0].params[7]);
  assert.equal(stored.indexedThroughBlock, 101);
  assert.equal(stored.tokenState.marker, "canonical");
  assert.equal(
    stored.workAmountStorageModel,
    WORK_ATOMIC_PROJECTION_MODEL,
  );
  assert.equal(stored.summaryRefresh.indexedThroughBlock, 101);
  assert.equal(stored.summaryRefresh.mode, "canonical-summary-refresh");
  assert.deepEqual(
    stored.summaryRefresh.publicLogFingerprint,
    publicLogFingerprint,
  );
  assert.equal(stored.activityPayload.marker, "derived-full-101");
  assert.ok(stored.sourceHashes.canonicalSummary);
  assert.match(
    inserted[0].sql,
    /issuanceValueSnapshotId[\s\S]*EXCLUDED\.snapshot_id/u,
  );
  assert.ok(
    Object.values(stored.summaryPayloads).every(
      (payload) => payload.indexedThroughBlock === 101,
    ),
  );

  const currentSummaryPayloads = Object.fromEntries(
    requiredKeys.map((key) => [key, summaryFor(key, 101)]),
  );
  Object.assign(
    currentSummaryPayloads.workFloor,
    exactWorkFloorFixture("4200000000000000", {
      creditMinerFeeAccountingModel:
        "canonical-unique-tx-input-output-v1",
      creditMinerFeeCoverage: {
        complete: true,
        confirmedEvents: 2,
        confirmedTransactions: 1,
        coveredConfirmedEvents: 2,
        coveredConfirmedTransactions: 1,
        missingConfirmedEvents: 0,
        missingConfirmedTransactions: 0,
        missingConfirmedTxids: [],
        source: "proof-indexer-normalized-input-output-totals",
      },
    }),
  );
  currentSummaryPayloads.inceptionSummary.actualValue =
    currentInceptionActual;
  currentSummaryPayloads.inceptionSummary.networkValueSats = 746;
  currentSummaryPayloads.inceptionSummary.stats = {
    confirmedSupply: 746,
  };
  currentSummaryPayloads.inceptionSummary.token = {
    stats: { confirmedMints: 1 },
  };
  currentSummaryPayloads.workSummary.token = {
    stats: { confirmedTransfers: 0 },
  };
  currentSummaryPayloads.workSummary.workTransferValueProjection = {
    items: [],
    model: "canonical-work-transfer-value-projection-v1",
  };
  previousPayload = {
    ok: true,
    snapshotId: "full-101-current-models",
    status: "consistent",
    summaryPayloads: currentSummaryPayloads,
    summaryRefresh: { publicLogFingerprint },
  };
  const currentResult = await storeCanonicalSummarySnapshot({
    async query() {
      throw new Error("A current same-tip accounting snapshot must not write");
    },
  });
  assert.equal(currentResult.skipped, true);
  assert.equal(currentResult.reason, "already-current");
  assert.equal(currentResult.snapshotId, "full-101-current-models");
  assert.equal(inserted.length, 1);
});

check("ledger snapshot retention preserves pinned issuance oracles", async () => {
  let queryText = "";
  let queryParams = [];
  const pruneLedgerSnapshots = isolatedFunction(
    BACKFILL_PATH,
    "pruneLedgerSnapshots",
    {
      LEDGER_CANONICAL_SUMMARY_RETENTION: 4_096,
      LEDGER_SCAN_SNAPSHOT_RETENTION: 20_000,
      NETWORK: "livenet",
    },
  );
  const result = await pruneLedgerSnapshots(
    {
      async query(sql, params) {
        queryText = String(sql);
        queryParams = Array.from(params);
        return {
          rows: [
            { canonical_summary: true, snapshot_id: "old-summary" },
            { canonical_summary: false, snapshot_id: "old-scan" },
          ],
        };
      },
    },
    { canonicalSummaryLimit: 4_096, scanSnapshotLimit: 20_000 },
  );
  assert.deepEqual(queryParams, [
    "livenet",
    4_096,
    20_000,
    "canonical:rebuild",
    INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
  ]);
  assert.match(queryText, /row_number\(\) OVER/u);
  assert.match(queryText, /payload->>'issuanceValueSnapshotId'/u);
  assert.match(queryText, /NOT EXISTS/u);
  assert.match(queryText, /DELETE FROM proof_indexer\.ledger_snapshots/u);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    canonicalSummaries: 1,
    scanOrDerived: 1,
    total: 2,
  });
});

check("derived ledger snapshots expose atomic WORK only after the definition is ready", async () => {
  const run = async (ready) => {
    const writes = [];
    const storeLedgerSnapshot = isolatedFunction(
      BACKFILL_PATH,
      "storeLedgerSnapshot",
      {
        NETWORK: "livenet",
        REFRESH_SUMMARY_SNAPSHOT_SOURCES: false,
        TOKEN_HISTORY_SNAPSHOT_SCOPES: [],
        WORK_ATOMIC_PROJECTION_MODEL,
        activitySnapshot: async () => null,
        fallbackLedgerSnapshotPayload: async () => {
          throw new Error("fixture must not use fallback");
        },
        latestIndexedBlockHeight: async () => 100,
        numberOrNull: (value) => {
          const number = Number(value);
          return Number.isFinite(number) ? number : null;
        },
        readJson: async () => ({
          checks: [],
          generatedAt: "2026-07-16T12:00:00.000Z",
          indexedThroughBlock: 100,
          metrics: { indexedThroughBlock: 100 },
          missingLogEvents: [],
          ok: true,
          snapshotId: "ledger-100",
          sourceHashes: {},
          status: "green",
          workAmountStorageModel: "untrusted-incoming-marker",
        }),
        registryHistorySnapshots: async () => ({}),
        storedLedgerSnapshotPayload: async () => ({
          workAmountStorageModel: "untrusted-stored-marker",
        }),
        strongerSummaryPayloads: (_base, candidate) => candidate,
        summaryPayloadsWithAlignedWorkFloor: (value) => value,
        summarySnapshotSourceParams: () => ({}),
        summarySnapshots: async () => ({}),
        tokenHistorySnapshotsForScope: async () => {
          throw new Error("no token scopes expected");
        },
        unpagedEndpoint: (pathname) => ({ pathname }),
        workAtomicProjectionReady: async () => ready,
      },
    );
    const payload = await storeLedgerSnapshot({
      async query(sql, params) {
        writes.push({ params: Array.from(params), sql: String(sql) });
        return { rows: [] };
      },
    });
    assert.equal(writes.length, 1);
    assert.match(
      writes[0].sql,
      /issuanceValueSnapshotId[\s\S]*EXCLUDED\.snapshot_id/u,
    );
    return payload;
  };

  const marked = await run(true);
  assert.equal(
    marked.workAmountStorageModel,
    WORK_ATOMIC_PROJECTION_MODEL,
  );
  const unmarked = await run(false);
  assert.equal("workAmountStorageModel" in unmarked, false);
});

check("WORK atomic post-bootstrap verification requires a marked green exact-tip summary", async () => {
  const queries = [];
  const exactTipRow = {
    block_hash: "a".repeat(64),
    indexed_through_block: 958_250,
    snapshot_id: "marked-exact-tip",
  };
  const markedExactTipWorkAtomicSummary = isolatedFunction(
    BACKFILL_PATH,
    "markedExactTipWorkAtomicSummary",
    {
      NETWORK: "livenet",
      WORK_ATOMIC_PROJECTION_MODEL,
    },
  );
  const selected = await markedExactTipWorkAtomicSummary({
    async query(sql, params) {
      queries.push({ params: Array.from(params), sql: String(sql) });
      return { rows: [exactTipRow] };
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), {
    indexedThroughBlock: exactTipRow.indexed_through_block,
    indexedThroughBlockHash: exactTipRow.block_hash,
    snapshotId: exactTipRow.snapshot_id,
  });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [
    "livenet",
    WORK_ATOMIC_PROJECTION_MODEL,
  ]);
  assert.match(queries[0].sql, /latest_scan/u);
  assert.match(
    queries[0].sql,
    /payload->>'workAmountStorageModel' = \$2/u,
  );
  assert.match(
    queries[0].sql,
    /token-components-cover-confirmed-activity/u,
  );
  assert.match(
    queries[0].sql,
    /canonical-activity-count-matches-public-log/u,
  );

  const assertWorkAtomicIssuanceOracleSnapshots = isolatedFunction(
    BACKFILL_PATH,
    "assertWorkAtomicIssuanceOracleSnapshots",
  );
  const assertWorkAtomicSnapshotMigrationState = isolatedFunction(
    BACKFILL_PATH,
    "assertWorkAtomicSnapshotMigrationState",
    { objectValue },
  );
  let exactTipSummary = selected;
  const issuanceOracles = [
    {
      fingerprint: "unchanged-oracle-row",
      resolved: true,
      snapshotId: "h-minus-one",
    },
  ];
  const verifyWorkAtomicPostBootstrap = isolatedFunction(
    BACKFILL_PATH,
    "verifyWorkAtomicPostBootstrap",
    {
      assertWorkAtomicIssuanceOracleSnapshots,
      assertWorkAtomicSnapshotMigrationState,
      auditWorkAtomicProjection: async () => ({
        atomic: true,
        snapshots: {
          unmarked_derived: 1,
          unmarked_derived_referenced: 1,
          unmarked_non_oracle_derived: 0,
        },
      }),
      markedExactTipWorkAtomicSummary: async () => exactTipSummary,
      workAtomicIssuanceOracleSnapshotState: async () =>
        issuanceOracles,
    },
  );
  const verified = await verifyWorkAtomicPostBootstrap({});
  assert.equal(verified.exactTipSummary.snapshotId, "marked-exact-tip");
  assert.deepEqual(verified.issuanceOracleSnapshotIds, [
    "h-minus-one",
  ]);
  exactTipSummary = null;
  await assert.rejects(
    verifyWorkAtomicPostBootstrap({}),
    /marked green exact-tip canonical summary/u,
  );
});

check("WORK atomic migration is exact per row and idempotently preserves H-1 oracles", async () => {
  const canonicalJsonText = isolatedFunction(
    BACKFILL_PATH,
    "canonicalJsonText",
  );
  const assertWorkAtomicBalanceMigration = isolatedFunction(
    BACKFILL_PATH,
    "assertWorkAtomicBalanceMigration",
    { WORK_UNIT_SCALE },
  );
  const assertWorkAtomicListingMigration = isolatedFunction(
    BACKFILL_PATH,
    "assertWorkAtomicListingMigration",
    {
      WORK_DECIMALS,
      WORK_UNIT_SCALE,
      WORK_UNIT_SCALE_TEXT,
      canonicalJsonText,
      objectValue,
    },
  );
  const assertWorkAtomicIssuanceOracleSnapshots = isolatedFunction(
    BACKFILL_PATH,
    "assertWorkAtomicIssuanceOracleSnapshots",
  );
  const assertWorkAtomicEventMigration = isolatedFunction(
    BACKFILL_PATH,
    "assertWorkAtomicEventMigration",
    { objectValue },
  );
  const assertWorkAtomicSnapshotMigrationState = isolatedFunction(
    BACKFILL_PATH,
    "assertWorkAtomicSnapshotMigrationState",
    { objectValue },
  );

  const legacyBalances = [
    { address: "alice", confirmedBalance: "2", pendingDelta: "-1" },
  ];
  const atomicBalances = [
    {
      address: "alice",
      confirmedBalance: "200000000",
      pendingDelta: "-100000000",
    },
  ];
  const immutableAuthorization = {
    amount: "3",
    signature: "signed-listing-terms",
    version: "pwt-sale-v1",
  };
  const legacyListings = [
    {
      amount: "3",
      buyerAddress: "buyer",
      closeTxid: "close",
      listingId: "listing",
      payload: {
        amount: "3",
        saleAuthorization: immutableAuthorization,
      },
      priceSats: "1000",
      saleTicketTxid: "ticket",
      saleTicketValueSats: "546",
      saleTicketVout: 2,
      sealTxid: "seal",
      sellerAddress: "seller",
      status: "active",
    },
  ];
  const atomicListings = [
    {
      ...legacyListings[0],
      amount: "300000000",
      payload: {
        ...legacyListings[0].payload,
        amountAtoms: "300000000",
        decimals: WORK_DECIMALS,
        unitScale: WORK_UNIT_SCALE_TEXT,
      },
    },
  ];
  const issuanceOracles = [
    {
      fingerprint: "byte-identical-h-minus-one-row",
      resolved: true,
      snapshotId: "oracle",
    },
  ];
  assert.doesNotThrow(() =>
    assertWorkAtomicBalanceMigration(
      legacyBalances,
      atomicBalances,
    ),
  );
  assert.throws(
    () =>
      assertWorkAtomicBalanceMigration(legacyBalances, [
        {
          ...atomicBalances[0],
          confirmedBalance: "200000001",
        },
      ]),
    /exact unit scale/u,
  );
  assert.doesNotThrow(() =>
    assertWorkAtomicListingMigration(
      legacyListings,
      atomicListings,
    ),
  );
  assert.throws(
    () =>
      assertWorkAtomicListingMigration(legacyListings, [
        {
          ...atomicListings[0],
          payload: {
            ...atomicListings[0].payload,
            saleAuthorization: {
              ...immutableAuthorization,
              signature: "changed",
            },
          },
        },
      ]),
    /outside its exact amount projection/u,
  );
  const eventCounters = {
    amount_events: 21_850,
    confirmed_mints: 20_999,
    confirmed_sales: 7,
    confirmed_transfers: 311,
  };
  assert.doesNotThrow(() =>
    assertWorkAtomicEventMigration(
      eventCounters,
      structuredClone(eventCounters),
    ),
  );
  assert.throws(
    () =>
      assertWorkAtomicEventMigration(eventCounters, {
        ...eventCounters,
        confirmed_transfers: eventCounters.confirmed_transfers - 1,
      }),
    /confirmed_transfers event counter/u,
  );
  let invalidationSql = "";
  let invalidationParams = [];
  const invalidateStoredWorkAtomicDerivedSnapshots = isolatedFunction(
    BACKFILL_PATH,
    "invalidateWorkAtomicDerivedSnapshots",
    {
      NETWORK: "livenet",
      WORK_ATOMIC_PROJECTION_MODEL,
    },
  );
  assert.deepEqual(
    await invalidateStoredWorkAtomicDerivedSnapshots({
      async query(sql, params) {
        invalidationSql = String(sql);
        invalidationParams = Array.from(params);
        return { rows: [{ snapshot_id: "stale-derived" }] };
      },
    }),
    ["stale-derived"],
  );
  assert.deepEqual(invalidationParams, [
    "livenet",
    WORK_ATOMIC_PROJECTION_MODEL,
    "canonical:rebuild",
    INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
  ]);
  assert.match(invalidationSql, /workAmountStorageModel/u);
  assert.match(invalidationSql, /issuanceValueSnapshotId/u);
  assert.match(invalidationSql, /NOT EXISTS/u);
  assert.match(invalidationSql, /source_hashes \? 'canonicalSummary'/u);

  let atomic = false;
  let balances = legacyBalances;
  let listings = legacyListings;
  let snapshots = [
    { derived: true, marked: false, oracle: true, snapshotId: "oracle" },
    { derived: true, marked: false, oracle: false, snapshotId: "stale-1" },
  ];
  const snapshotCounts = () => ({
    derived: snapshots.filter((row) => row.derived).length,
    issuance_locked: snapshots.filter((row) => row.oracle).length,
    marked: snapshots.filter((row) => row.marked).length,
    total: snapshots.length,
    unmarked_derived: snapshots.filter(
      (row) => row.derived && !row.marked,
    ).length,
    unmarked_derived_referenced: snapshots.filter(
      (row) => row.derived && !row.marked && row.oracle,
    ).length,
    unmarked_non_oracle_derived: snapshots.filter(
      (row) => row.derived && !row.marked && !row.oracle,
    ).length,
  });
  const auditWorkAtomicProjection = async () => ({
    atomic,
    balances: {
      confirmed_supply: atomic ? "200000000" : "2",
      pending_delta: atomic ? "-100000000" : "-1",
      rows: 1,
    },
    events: {
      amount_events: 2,
      atom_events: atomic ? 2 : 0,
      confirmed_mints: 1,
      confirmed_sales: 0,
      confirmed_transfers: 1,
      invalid_atom_events: 0,
      invalid_legacy_events: 0,
      mismatched_atom_events: 0,
    },
    legacy: !atomic,
    listings: { rows: 1 },
    reservations: { oversubscribed_sellers: 0 },
    snapshots: snapshotCounts(),
  });
  const invalidateWorkAtomicDerivedSnapshots = async () => {
    const removed = snapshots
      .filter((row) => row.derived && !row.marked && !row.oracle)
      .map((row) => row.snapshotId);
    snapshots = snapshots.filter(
      (row) => !row.derived || row.marked || row.oracle,
    );
    return removed;
  };
  const calls = [];
  const workAtomicProjectionReadyByClient = new WeakMap();
  const migrateWorkAtomicProjection = isolatedFunction(
    BACKFILL_PATH,
    "migrateWorkAtomicProjection",
    {
      NETWORK: "livenet",
      WORK_ATOMIC_PROJECTION_MODEL,
      WORK_DECIMALS,
      WORK_TOKEN_ID,
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_TOKEN_MAX_SUPPLY_ATOMS: "2100000000000000",
      WORK_TOKEN_MINT_AMOUNT: 1_000,
      WORK_TOKEN_MINT_AMOUNT_ATOMS: "100000000000",
      WORK_UNIT_SCALE,
      WORK_UNIT_SCALE_TEXT,
      assertWorkAtomicBalanceMigration,
      assertWorkAtomicEventMigration,
      assertWorkAtomicIssuanceOracleSnapshots,
      assertWorkAtomicListingMigration,
      assertWorkAtomicSnapshotMigrationState,
      auditWorkAtomicProjection,
      invalidateWorkAtomicDerivedSnapshots,
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => ({
        holders: 1,
        tokens: 1,
      }),
      workAtomicBalanceMigrationRows: async () => balances,
      workAtomicIssuanceOracleSnapshotState: async () =>
        issuanceOracles,
      workAtomicListingMigrationRows: async () => listings,
      workAtomicProjectionReady: async () => atomic,
      workAtomicProjectionReadyByClient,
    },
  );
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ params: Array.from(params), sql: text });
      if (text.includes("UPDATE proof_indexer.credit_balances")) {
        balances = atomicBalances;
      }
      if (text.includes("UPDATE proof_indexer.credit_listings")) {
        listings = atomicListings;
      }
      if (text.includes("UPDATE proof_indexer.credit_definitions")) {
        atomic = true;
      }
      return { rows: [] };
    },
  };

  const first = await migrateWorkAtomicProjection(client);
  assert.equal(first.alreadyApplied, false);
  assert.equal(first.bootstrapRequired, true);
  assert.deepEqual(first.invalidatedSnapshotIds, ["stale-1"]);
  assert.deepEqual(
    snapshots.map((row) => row.snapshotId),
    ["oracle"],
  );
  assert.doesNotThrow(() =>
    assertWorkAtomicIssuanceOracleSnapshots(
      issuanceOracles,
      structuredClone(issuanceOracles),
    ),
  );

  snapshots.push(
    {
      derived: true,
      marked: true,
      oracle: false,
      snapshotId: "marked-current",
    },
    {
      derived: true,
      marked: false,
      oracle: false,
      snapshotId: "stale-2",
    },
  );
  const second = await migrateWorkAtomicProjection(client);
  assert.equal(second.alreadyApplied, true);
  assert.deepEqual(second.invalidatedSnapshotIds, ["stale-2"]);
  assert.deepEqual(
    snapshots.map((row) => row.snapshotId),
    ["oracle", "marked-current"],
  );
  const allSql = calls.map((call) => call.sql).join("\n");
  assert.match(
    allSql,
    /LOCK TABLE[\s\S]*proof_indexer\.transactions/u,
  );
  const eventUpdate = calls.find((call) =>
    call.sql.includes("UPDATE proof_indexer.events"),
  );
  assert.ok(eventUpdate);
  assert.doesNotMatch(eventUpdate.sql, /AND valid = true/u);
  const atomicAuditSource = topLevelFunctionSource(
    BACKFILL_PATH,
    "auditWorkAtomicProjection",
  );
  assert.match(
    atomicAuditSource,
    /mismatched_atom_events[\s\S]*e\.valid = true[\s\S]*confirmed_mints/u,
  );
  assert.doesNotMatch(
    atomicAuditSource,
    /Promise\.all/u,
    "one transaction-bound pg client must run the five atomic audit reads sequentially",
  );
  assert.match(atomicAuditSource, /for \(const query of atomicAuditQueries\)/u);
});

check("canonical summary publication allows cumulative INCB dust across independently floored mints", () => {
  const canonicalSummaryAccountingModelsCurrent = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryAccountingModelsCurrent",
    {
      exactWorkNetworkValueSummaryBinding:
        isolatedExactWorkNetworkValueSummaryBinding(),
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_NETWORK_VALUE_ACCOUNTING_MODEL:
        "fixed-incb-issuance-plus-market-flow-v1",
      INCB_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      WORK_TOKEN_ID:
        "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
      WORK_TRANSFER_VALUE_PROJECTION_MODEL:
        "canonical-work-transfer-value-projection-v1",
    },
  );
  const minerFeeCoverage = {
    complete: true,
    confirmedEvents: 2,
    confirmedTransactions: 1,
    coveredConfirmedEvents: 2,
    coveredConfirmedTransactions: 1,
    missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0,
    missingConfirmedTxids: [],
    source: "proof-indexer-normalized-input-output-totals",
  };
  const actualValue = {
    attachedWorkIssuanceUnits: 3_132_313_922,
    attachedWorkLiveValueAtSendSats: 3_132_313_923.5410833,
    attachmentAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    bondMarketplaceMutationFeeSats: 0,
    bondSaleVolumeSats: 0,
    bondTransferFeeSats: 0,
    confirmedIssuanceUnits: 3_132_315_014,
    directProofIssuanceUnits: 1_092,
    floorSats: 3_132_315_015.5410833 / 3_132_315_014,
    frozenFloorSats: 3_132_315_015.5410833 / 3_132_315_014,
    frozenNetworkValueSats: 3_132_315_015.5410833,
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceCheckpointBlockHeight: 958_007,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustSats: 1.5410833358764648,
    issuanceFloorSats: 3_132_315_015.5410833 / 3_132_315_014,
    issuanceNetworkValueSats: 3_132_315_015.5410833,
    issuanceValueSnapshotBlockHash: "a".repeat(64),
    issuanceValueSnapshotBlockHeight: 958_006,
    issuanceValueSnapshotCanonicalSummaryHash: "b".repeat(64),
    issuanceValueSnapshotGeneratedAt: "2026-07-14T06:00:00.000Z",
    issuanceValueSnapshotId: "latest-pre-bond-snapshot",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueSats: 9_857_361_066.004198,
    liveFloorSats: 3_132_315_015.5410833 / 3_132_315_014,
    liveNetworkValueSats: 3_132_315_015.5410833,
    networkValueAccountingModel:
      "fixed-incb-issuance-plus-market-flow-v1",
    networkValueSats: 3_132_315_015.5410833,
  };
  const firstExactIssuance = 1_421_799_461.6275952;
  const secondExactIssuance = 1_710_515_553.9134884;
  const independentlyFlooredIssuance =
    Math.floor(firstExactIssuance) + Math.floor(secondExactIssuance);
  const combinedFloor = Math.floor(firstExactIssuance + secondExactIssuance);
  const cumulativeDust =
    firstExactIssuance +
    secondExactIssuance -
    independentlyFlooredIssuance;
  assert.equal(independentlyFlooredIssuance, 3_132_315_014);
  assert.equal(combinedFloor, 3_132_315_015);
  assert.ok(Math.abs(cumulativeDust - 1.5410833358764648) < 1e-12);
  const summaryPayloads = (confirmedMints) => ({
    inceptionSummary: {
      actualValue,
      networkValueSats: actualValue.networkValueSats,
      stats: { confirmedSupply: actualValue.confirmedIssuanceUnits },
      token: { stats: { confirmedMints } },
    },
    workFloor: exactWorkFloorFixture("985736106600419800", {
        creditMinerFeeAccountingModel:
          "canonical-unique-tx-input-output-v1",
        creditMinerFeeCoverage: minerFeeCoverage,
    }),
    workSummary: {
      token: { stats: { confirmedTransfers: 0 } },
      workTransferValueProjection: {
        items: [],
        model: "canonical-work-transfer-value-projection-v1",
      },
    },
  });

  assert.equal(
    canonicalSummaryAccountingModelsCurrent(summaryPayloads(2)),
    true,
    "two independent mint floors may leave cumulative dust above one proof",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(summaryPayloads(1)),
    false,
    "cumulative dust must remain below the number of confirmed mints",
  );
  const productionMagnitudeIssuance = {
    ...actualValue,
    attachedWorkIssuanceUnits: 108_304_295_445_969,
    attachedWorkLiveValueAtSendSats: 108_304_295_445_983.2,
    confirmedIssuanceUnits: 108_304_295_462_803,
    directProofIssuanceUnits: 16_834,
    floorSats: 1.0000000000001312,
    frozenFloorSats: 1.0000000000001312,
    frozenNetworkValueSats: 108_304_295_462_817.2,
    issuanceDustSats: 14.203125,
    issuanceFloorSats: 1.0000000000001312,
    issuanceNetworkValueSats: 108_304_295_462_817.2,
    liveFloorSats: 1.0000000000001312,
    liveNetworkValueSats: 108_304_295_462_817.2,
    networkValueSats: 108_304_295_462_817.2,
  };
  const productionMagnitudeSummary = summaryPayloads(30);
  productionMagnitudeSummary.inceptionSummary = {
    actualValue: productionMagnitudeIssuance,
    networkValueSats: productionMagnitudeIssuance.networkValueSats,
    stats: {
      confirmedSupply: productionMagnitudeIssuance.confirmedIssuanceUnits,
    },
    token: { stats: { confirmedMints: 30 } },
  };
  assert.equal(
    productionMagnitudeIssuance.issuanceFloorSats *
      productionMagnitudeIssuance.confirmedIssuanceUnits -
      productionMagnitudeIssuance.issuanceNetworkValueSats,
    0.015625,
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(productionMagnitudeSummary),
    true,
    "production-scale INCB issuance accepts only sub-proof floating-point noise",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...productionMagnitudeSummary,
      inceptionSummary: {
        ...productionMagnitudeSummary.inceptionSummary,
        actualValue: {
          ...productionMagnitudeIssuance,
          issuanceNetworkValueSats:
            productionMagnitudeIssuance.issuanceNetworkValueSats + 1,
        },
      },
    }),
    false,
    "production-scale INCB issuance still rejects a one-proof discrepancy",
  );

  const exactTipLiveFloorSats = 683.8074244507424;
  const exactTipLiveFloorQ8 = decimalValueToQ8(exactTipLiveFloorSats);
  const exactProjectedTransfer = ({
    amount = "3644060",
    fixedEventFlowSats = 546,
    liveFloorQ8 = exactTipLiveFloorQ8,
    networkValueBeforeEventQ8,
    snapshotBlockHash,
    snapshotBlockHeight,
    snapshotId,
    txid,
  }) => {
    const amountAtoms = parseWorkAmountToAtoms(amount);
    const networkQ8 = BigInt(networkValueBeforeEventQ8);
    const creditFloorAtConfirmQ8 = networkQ8 / 21_000_000n;
    const creditValueAtConfirmQ8 =
      (BigInt(amountAtoms) * networkQ8) /
      (21_000_000n * WORK_UNIT_SCALE);
    const creditLiveValueQ8 =
      (BigInt(amountAtoms) * liveFloorQ8) / WORK_UNIT_SCALE;
    const fixedEventFlowQ8 =
      BigInt(fixedEventFlowSats) * VALUE_Q8_SCALE;
    const frozenNetworkValueQ8 =
      creditValueAtConfirmQ8 + fixedEventFlowQ8;
    const liveNetworkValueQ8 = creditLiveValueQ8 + fixedEventFlowQ8;
    return {
      amount,
      amountAtoms,
      confirmed: true,
      creditAmountMoved: Number(amount),
      creditFloorAtConfirmModel:
        "canonical-incb-h-minus-one-live-work-v1",
      creditFloorAtConfirmQ8: creditFloorAtConfirmQ8.toString(),
      creditFloorAtConfirmSats:
        q8ToCanonicalDecimal(creditFloorAtConfirmQ8),
      creditLiveFloorQ8: liveFloorQ8.toString(),
      creditLiveFloorSats: q8ToCanonicalDecimal(liveFloorQ8),
      creditLiveValueQ8: creditLiveValueQ8.toString(),
      creditLiveValueSats: q8ToCanonicalDecimal(creditLiveValueQ8),
      creditRevaluationFloorQ8: liveFloorQ8.toString(),
      creditRevaluationFloorSats:
        q8ToCanonicalDecimal(liveFloorQ8),
      creditValueAtConfirmQ8: creditValueAtConfirmQ8.toString(),
      creditValueAtConfirmSats:
        q8ToCanonicalDecimal(creditValueAtConfirmQ8),
      fixedEventFlowSats,
      frozenNetworkValueQ8: frozenNetworkValueQ8.toString(),
      frozenNetworkValueSats:
        q8ToCanonicalDecimal(frozenNetworkValueQ8),
      liveNetworkValueBeforeEventQ8: networkQ8.toString(),
      liveNetworkValueBeforeEventSats: q8ToCanonicalDecimal(networkQ8),
      liveNetworkValueQ8: liveNetworkValueQ8.toString(),
      liveNetworkValueSats: q8ToCanonicalDecimal(liveNetworkValueQ8),
      networkValueBeforeEventQ8: networkQ8.toString(),
      networkValueBeforeEventSats: q8ToCanonicalDecimal(networkQ8),
      tokenId:
        "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
      txid,
      valueSnapshotBlockHash: snapshotBlockHash,
      valueSnapshotBlockHeight: snapshotBlockHeight,
      valueSnapshotCanonicalSummaryHash: "b".repeat(64),
      valueSnapshotGeneratedAt: "2026-07-14T06:00:00.000Z",
      valueSnapshotId: snapshotId,
    };
  };
  const projectedTransfer = exactProjectedTransfer({
    networkValueBeforeEventQ8: "985736106600419800",
    snapshotBlockHash: "c".repeat(64),
    snapshotBlockHeight: 958_006,
    snapshotId: "exact-h-minus-one-snapshot",
    txid: "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21",
  });
  const firstProjectedTransfer = exactProjectedTransfer({
    networkValueBeforeEventQ8: "819354709532211304",
    snapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    snapshotBlockHeight: 957_949,
    snapshotId: "first-exact-h-minus-one-snapshot",
    txid: "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4",
  });
  const exactProjectionSummary = summaryPayloads(2);
  exactProjectionSummary.workSummary = {
    floor: { liveFloorSats: exactTipLiveFloorSats },
    token: { stats: { confirmedTransfers: 2 } },
    workTransferValueProjection: {
      items: [firstProjectedTransfer, projectedTransfer],
      model: "canonical-work-transfer-value-projection-v1",
    },
  };
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(exactProjectionSummary),
    true,
    "the projection must reconcile immutable H-1 value with the exact-tip live floor",
  );
  const productionScaleLiveFloorSats = 11_678_198.442567484;
  const productionScaleLiveFloorQ8 = decimalValueToQ8(
    productionScaleLiveFloorSats,
  );
  const productionScaleProjection = exactProjectedTransfer({
    amount: "3574060",
    fixedEventFlowSats: 969,
    liveFloorQ8: productionScaleLiveFloorQ8,
    networkValueBeforeEventQ8: (
      decimalValueToQ8("5975464.60788162") * 21_000_000n +
      12_345_678n
    ).toString(),
    snapshotBlockHash: "d".repeat(64),
    snapshotBlockHeight: 958_306,
    snapshotId: "production-scale-h-minus-one-snapshot",
    txid: "697d282ce2d0b57d7c17b91a907c4dcf1a5327b0b02eebf19963611d8e63322d",
  });
  const productionScaleSummary = summaryPayloads(2);
  productionScaleSummary.workSummary = {
    floor: { liveFloorSats: productionScaleLiveFloorSats },
    token: { stats: { confirmedTransfers: 1 } },
    workTransferValueProjection: {
      items: [productionScaleProjection],
      model: "canonical-work-transfer-value-projection-v1",
    },
  };
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(productionScaleSummary),
    true,
    "production-scale atomic valuation must use the same exact Q8 projection as the API",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...productionScaleSummary,
      workSummary: {
        ...productionScaleSummary.workSummary,
        workTransferValueProjection: {
          ...productionScaleSummary.workSummary.workTransferValueProjection,
          items: [
            {
              ...productionScaleProjection,
              creditLiveValueSats:
                productionScaleProjection.creditLiveValueSats + 1,
            },
          ],
        },
      },
    }),
    false,
    "the production-scale tolerance cannot hide a one-proof valuation error",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...productionScaleSummary,
      workSummary: {
        ...productionScaleSummary.workSummary,
        workTransferValueProjection: {
          ...productionScaleSummary.workSummary.workTransferValueProjection,
          items: [
            {
              ...productionScaleProjection,
              creditLiveFloorSats:
                productionScaleProjection.creditLiveFloorSats + 0.009,
            },
          ],
        },
      },
    }),
    false,
    "a copied live floor must match exactly instead of accepting a 0.009 proof drift",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...productionScaleSummary,
      workSummary: {
        ...productionScaleSummary.workSummary,
        workTransferValueProjection: {
          ...productionScaleSummary.workSummary.workTransferValueProjection,
          items: [
            {
              ...productionScaleProjection,
              creditLiveValueSats: "Infinity",
            },
          ],
        },
      },
    }),
    false,
    "non-finite projected values must fail closed",
  );
  const fractionalProductionAmount = "20999999.12345678";
  const fractionalProductionAmountAtoms = parseWorkAmountToAtoms(
    fractionalProductionAmount,
  );
  const highMagnitudeLiveFloorSats = 30_000_000.12345678;
  const highMagnitudeLiveFloorQ8 = decimalValueToQ8(
    highMagnitudeLiveFloorSats,
  );
  const highMagnitudeNetworkValueBeforeEventQ8 =
    highMagnitudeLiveFloorQ8 * 21_000_000n + 7_654_321n;
  const highMagnitudeLiveValueQ8 =
    (BigInt(fractionalProductionAmountAtoms) * highMagnitudeLiveFloorQ8) /
    WORK_UNIT_SCALE;
  const highMagnitudeConfirmValueQ8 =
    (BigInt(fractionalProductionAmountAtoms) *
      highMagnitudeNetworkValueBeforeEventQ8) /
    (21_000_000n * WORK_UNIT_SCALE);
  const highMagnitudeFrozenNetworkValueQ8 =
    highMagnitudeConfirmValueQ8 + 546n * VALUE_Q8_SCALE;
  const highMagnitudeLiveNetworkValueQ8 =
    highMagnitudeLiveValueQ8 + 546n * VALUE_Q8_SCALE;
  const highMagnitudeProjection = {
    amount: fractionalProductionAmount,
    amountAtoms: fractionalProductionAmountAtoms,
    confirmed: true,
    creditAmountMoved: Number(fractionalProductionAmount),
    creditFloorAtConfirmModel: "canonical-work-live-floor-v1",
    creditFloorAtConfirmQ8: highMagnitudeLiveFloorQ8.toString(),
    creditFloorAtConfirmSats:
      q8ToCanonicalDecimal(highMagnitudeLiveFloorQ8),
    creditLiveFloorQ8: highMagnitudeLiveFloorQ8.toString(),
    creditLiveFloorSats: q8ToCanonicalDecimal(highMagnitudeLiveFloorQ8),
    creditLiveValueQ8: highMagnitudeLiveValueQ8.toString(),
    creditLiveValueSats: q8ToCanonicalDecimal(highMagnitudeLiveValueQ8),
    creditRevaluationFloorQ8: highMagnitudeLiveFloorQ8.toString(),
    creditRevaluationFloorSats:
      q8ToCanonicalDecimal(highMagnitudeLiveFloorQ8),
    creditValueAtConfirmQ8: highMagnitudeConfirmValueQ8.toString(),
    creditValueAtConfirmSats:
      q8ToCanonicalDecimal(highMagnitudeConfirmValueQ8),
    fixedEventFlowSats: 546,
    frozenNetworkValueQ8: highMagnitudeFrozenNetworkValueQ8.toString(),
    frozenNetworkValueSats:
      q8ToCanonicalDecimal(highMagnitudeFrozenNetworkValueQ8),
    liveNetworkValueBeforeEventQ8:
      highMagnitudeNetworkValueBeforeEventQ8.toString(),
    liveNetworkValueBeforeEventSats:
      q8ToCanonicalDecimal(highMagnitudeNetworkValueBeforeEventQ8),
    liveNetworkValueQ8: highMagnitudeLiveNetworkValueQ8.toString(),
    liveNetworkValueSats:
      q8ToCanonicalDecimal(highMagnitudeLiveNetworkValueQ8),
    networkValueBeforeEventQ8:
      highMagnitudeNetworkValueBeforeEventQ8.toString(),
    networkValueBeforeEventSats:
      q8ToCanonicalDecimal(highMagnitudeNetworkValueBeforeEventQ8),
    tokenId:
      "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    txid: "e".repeat(64),
  };
  const highMagnitudeSummary = summaryPayloads(2);
  highMagnitudeSummary.workSummary = {
    floor: { liveFloorSats: highMagnitudeLiveFloorSats },
    token: { stats: { confirmedTransfers: 1 } },
    workTransferValueProjection: {
      items: [highMagnitudeProjection],
      model: "canonical-work-transfer-value-projection-v1",
    },
  };
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(highMagnitudeSummary),
    true,
    "fractional WORK atoms must reconcile at production-scale values above 6e14 proofs",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...highMagnitudeSummary,
      workSummary: {
        ...highMagnitudeSummary.workSummary,
        workTransferValueProjection: {
          ...highMagnitudeSummary.workSummary.workTransferValueProjection,
          items: [
            {
              ...highMagnitudeProjection,
              liveNetworkValueSats:
                highMagnitudeProjection.liveNetworkValueSats + 1,
            },
          ],
        },
      },
    }),
    false,
    "the high-magnitude tolerance must remain below one proof",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              creditLiveFloorSats: exactTipLiveFloorSats - 1,
            },
          ],
        },
      },
    }),
    false,
    "an intermediate or stale per-transfer live floor must not publish",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              liveNetworkValueSats: projectedTransfer.liveNetworkValueSats + 1,
            },
          ],
        },
      },
    }),
    false,
    "a projected live network value must preserve the transfer's fixed event flow",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              frozenNetworkValueSats:
                projectedTransfer.creditValueAtConfirmSats - 1,
            },
          ],
        },
      },
    }),
    false,
    "a negative fixed event-flow component must not publish",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              creditValueAtConfirmSats:
                firstProjectedTransfer.creditValueAtConfirmSats,
            },
          ],
        },
      },
    }),
    false,
    "each transfer's frozen credit value must equal its own H-1 floor",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              txid: firstProjectedTransfer.txid,
            },
          ],
        },
      },
    }),
    false,
    "duplicate movement identities cannot replace a missing projection row",
  );
});

check("canonical summary accounting is exact for the 958382 H-1 state and unsafe totals", () => {
  const canonicalSummaryAccountingModelsCurrent = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryAccountingModelsCurrent",
    {
      exactWorkNetworkValueSummaryBinding:
        isolatedExactWorkNetworkValueSummaryBinding(),
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_NETWORK_VALUE_ACCOUNTING_MODEL:
        "fixed-incb-issuance-plus-market-flow-v1",
      INCB_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      WORK_TOKEN_ID:
        "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
      WORK_TRANSFER_VALUE_PROJECTION_MODEL:
        "canonical-work-transfer-value-projection-v1",
    },
  );
  const coverage = {
    complete: true,
    confirmedEvents: 2,
    confirmedTransactions: 1,
    coveredConfirmedEvents: 2,
    coveredConfirmedTransactions: 1,
    missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0,
    missingConfirmedTxids: [],
    source: "proof-indexer-normalized-input-output-totals",
  };
  const exactActual = {
    attachedWorkIssuanceUnits: "108304295445969",
    attachedWorkLiveValueAtSendQ8: "10830429544598320233641",
    attachedWorkLiveValueAtSendSats: "108304295445983.20233641",
    attachmentAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    bondMarketplaceMutationFeeSats: "0",
    bondSaleVolumeSats: "0",
    bondTransferFeeSats: "0",
    confirmedIssuanceUnits: "108304295462803",
    directProofIssuanceUnits: "16834",
    floorQ8: "100000000",
    floorSats: "1",
    frozenFloorQ8: "100000000",
    frozenFloorSats: "1",
    frozenNetworkValueQ8: "10830429546281720233641",
    frozenNetworkValueSats: "108304295462817.20233641",
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceCheckpointBlockHeight: 958316,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustQ8: "1420233641",
    issuanceDustSats: "14.20233641",
    issuanceFloorQ8: "100000000",
    issuanceFloorSats: "1",
    issuanceNetworkValueQ8: "10830429546281720233641",
    issuanceNetworkValueSats: "108304295462817.20233641",
    issuanceValueSnapshotBlockHash: "a".repeat(64),
    issuanceValueSnapshotBlockHeight: 958315,
    issuanceValueSnapshotCanonicalSummaryHash: "b".repeat(64),
    issuanceValueSnapshotGeneratedAt: "2026-07-17T00:00:00.000Z",
    issuanceValueSnapshotId: "clone-958382-h-minus-one",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueQ8:
      "24524216729391716000000",
    issuanceValueSnapshotWorkNetworkValueSats:
      "245242167293917.16",
    liveFloorQ8: "100000000",
    liveFloorSats: "1",
    liveNetworkValueQ8: "10830429546281720233641",
    liveNetworkValueSats: "108304295462817.20233641",
    networkValueAccountingModel:
      "fixed-incb-issuance-plus-market-flow-v1",
    networkValueQ8: "10830429546281720233641",
    networkValueSats: "108304295462817.20233641",
  };
  const cloneLegacyH1Rows = [
    ["364406000000000", "8193547095.322113"],
    ["364406000000000", "9857361066.004198"],
    ["364406000000000", "14359955913.46559"],
    ["364406000000000", "19820559613.951237"],
    ["364406000000000", "27910929682.409424"],
    ["0", "40053698802.89271"],
    ["364406000000000", "40053713970.51511"],
    ["183200000000000", "58533847407.56886"],
    ["364406000000000", "58533847407.56886"],
    ["412800000000000", "58533847407.56886"],
    ["412800000000000", "141346005640.95007"],
    ["183200000000000", "141346005640.95007"],
    ["364406000000000", "141346005640.95007"],
    ["412800000000000", "367239453978.2878"],
    ["183200000000000", "367239453978.2878"],
    ["364406000000000", "755812775841.9274"],
    ["412800000000000", "1264285259372.2686"],
    ["364406000000000", "1264285259372.2686"],
    ["183200000000000", "1264285259372.2686"],
    ["364406000000000", "3762847933809.697"],
    ["412800000000000", "3762847933809.697"],
    ["183200000000000", "3762847933809.697"],
    ["183200000000000", "11933830648122.703"],
    ["412800000000000", "16941906432781.268"],
    ["364406000000000", "16941906432781.268"],
    ["398800000000000", "49998018861586.71"],
    ["183200000000000", "49998018861586.71"],
    ["357406000000000", "125484756765514.14"],
    ["357406000000000", "245242167293917.16"],
    ["183200000000000", "245242167293917.16"],
  ];
  assert.equal(cloneLegacyH1Rows.length, 30);
  assert.equal(
    cloneLegacyH1Rows.reduce(
      (total, [amountAtoms]) => total + BigInt(amountAtoms),
      0n,
    ),
    9428884000000000n,
    "the clone fixture must retain all attached WORK atoms",
  );
  const derivedCloneAttachedQ8 = cloneLegacyH1Rows.reduce(
    (total, [amountAtoms, h1NetworkValueSats]) => {
      const h1NetworkValueQ8 = q8TextFromDecimal(h1NetworkValueSats);
      assert.ok(h1NetworkValueQ8);
      return (
        total +
        (BigInt(amountAtoms) * BigInt(h1NetworkValueQ8)) /
          (BigInt(WORK_TOKEN_MAX_SUPPLY) * WORK_UNIT_SCALE)
      );
    },
    0n,
  );
  const rawLegacyAttachedAliasQ8 = 10830429544598320580070n;
  const staleFloatAttachedQ8 = 10830429544598320783926n;
  const networkFirstAttachedQ8 = BigInt(
    exactActual.attachedWorkLiveValueAtSendQ8,
  );
  assert.equal(
    derivedCloneAttachedQ8,
    networkFirstAttachedQ8,
    "all 30 legacy rows must derive the settled network-first Q8 aggregate",
  );
  assert.equal(
    rawLegacyAttachedAliasQ8 - networkFirstAttachedQ8,
    346429n,
    "the 30-row clone aggregate must not sum the rounded legacy attached-value aliases",
  );
  assert.equal(
    staleFloatAttachedQ8 - networkFirstAttachedQ8,
    550285n,
    "the 30-row clone aggregate must not reuse the stale binary-float fixture",
  );
  const summaryPayloads = (
    actualValue,
    confirmedSupply,
    confirmedMints = 30,
    { topLevelQ8 = true } = {},
  ) => ({
    inceptionSummary: {
      actualValue,
      ...(topLevelQ8 ? { networkValueQ8: actualValue.networkValueQ8 } : {}),
      networkValueSats: actualValue.networkValueSats,
      stats: { confirmedSupply },
      token: { stats: { confirmedMints } },
    },
    workFloor: exactWorkFloorFixture("24524216729391716000000", {
        creditMinerFeeAccountingModel:
          "canonical-unique-tx-input-output-v1",
        creditMinerFeeCoverage: coverage,
    }),
    workSummary: {
      token: { stats: { confirmedTransfers: 0 } },
      workTransferValueProjection: {
        items: [],
        model: "canonical-work-transfer-value-projection-v1",
      },
    },
  });

  assert.equal(
    canonicalSummaryAccountingModelsCurrent(
      summaryPayloads(exactActual, "108304295462803"),
    ),
    true,
    "the exact gate must accept the network-first 30-row 958382 aggregate",
  );

  const legacyActual = Object.fromEntries(
    Object.entries(exactActual).filter(([field]) => !field.endsWith("Q8")),
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(
      summaryPayloads(legacyActual, "108304295462803", 30, {
        topLevelQ8: false,
      }),
    ),
    true,
    "canonical decimal aliases must reconstruct the exact Q8 H-1 state without Number",
  );

  const unsafeSupply = 12_692_190_658_411_190n;
  const unsafeDirect = 16_834n;
  const unsafeAttached = unsafeSupply - unsafeDirect;
  const unsafeDustQ8 = 82_282_200n;
  const unsafeAttachedValueQ8 =
    unsafeAttached * BOND_VALUE_Q8_SCALE + unsafeDustQ8;
  const unsafeNetworkValueQ8 =
    unsafeSupply * BOND_VALUE_Q8_SCALE + unsafeDustQ8;
  const unsafeActual = {
    ...exactActual,
    attachedWorkIssuanceUnits: unsafeAttached.toString(),
    attachedWorkLiveValueAtSendQ8: unsafeAttachedValueQ8.toString(),
    attachedWorkLiveValueAtSendSats:
      decimalTextFromQ8(unsafeAttachedValueQ8),
    confirmedIssuanceUnits: unsafeSupply.toString(),
    directProofIssuanceUnits: unsafeDirect.toString(),
    frozenNetworkValueQ8: unsafeNetworkValueQ8.toString(),
    frozenNetworkValueSats: decimalTextFromQ8(unsafeNetworkValueQ8),
    issuanceDustQ8: unsafeDustQ8.toString(),
    issuanceDustSats: decimalTextFromQ8(unsafeDustQ8),
    issuanceNetworkValueQ8: unsafeNetworkValueQ8.toString(),
    issuanceNetworkValueSats: decimalTextFromQ8(unsafeNetworkValueQ8),
    liveNetworkValueQ8: unsafeNetworkValueQ8.toString(),
    liveNetworkValueSats: decimalTextFromQ8(unsafeNetworkValueQ8),
    networkValueQ8: unsafeNetworkValueQ8.toString(),
    networkValueSats: decimalTextFromQ8(unsafeNetworkValueQ8),
  };
  assert.ok(unsafeSupply > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(
      summaryPayloads(unsafeActual, unsafeSupply.toString()),
    ),
    true,
    "INCB supply and value above 2^53 must remain exact strings and BigInts",
  );
  const workAmount = "20999999.12345678";
  const workAmountAtoms = parseWorkAmountToAtoms(workAmount);
  const workConfirmFloorQ8 = decimalValueToQ8("400000000.12345678");
  const workLiveFloorQ8 = decimalValueToQ8("500000000.87654321");
  const workConfirmNetworkValueQ8 =
    workConfirmFloorQ8 * 21_000_000n + 12_345_678n;
  const workConfirmValueQ8 =
    (BigInt(workAmountAtoms) * workConfirmNetworkValueQ8) /
    (21_000_000n * WORK_UNIT_SCALE);
  const workLiveValueQ8 =
    (BigInt(workAmountAtoms) * workLiveFloorQ8) / WORK_UNIT_SCALE;
  const workFrozenNetworkValueQ8 =
    workConfirmValueQ8 + 546n * BOND_VALUE_Q8_SCALE;
  const workLiveNetworkValueQ8 =
    workLiveValueQ8 + 546n * BOND_VALUE_Q8_SCALE;
  const exactWorkProjection = {
    amount: workAmount,
    amountAtoms: workAmountAtoms,
    confirmed: true,
    creditAmountMoved: Number(workAmount),
    creditFloorAtConfirmModel: "canonical-work-live-floor-v1",
    creditFloorAtConfirmQ8: workConfirmFloorQ8.toString(),
    creditFloorAtConfirmSats: q8ToCanonicalDecimal(workConfirmFloorQ8),
    creditLiveFloorQ8: workLiveFloorQ8.toString(),
    creditLiveFloorSats: q8ToCanonicalDecimal(workLiveFloorQ8),
    creditLiveValueQ8: workLiveValueQ8.toString(),
    creditLiveValueSats: q8ToCanonicalDecimal(workLiveValueQ8),
    creditRevaluationFloorQ8: workLiveFloorQ8.toString(),
    creditRevaluationFloorSats: q8ToCanonicalDecimal(workLiveFloorQ8),
    creditValueAtConfirmQ8: workConfirmValueQ8.toString(),
    creditValueAtConfirmSats: q8ToCanonicalDecimal(workConfirmValueQ8),
    frozenNetworkValueQ8: workFrozenNetworkValueQ8.toString(),
    frozenNetworkValueSats:
      q8ToCanonicalDecimal(workFrozenNetworkValueQ8),
    fixedEventFlowSats: 546,
    liveNetworkValueQ8: workLiveNetworkValueQ8.toString(),
    liveNetworkValueSats: q8ToCanonicalDecimal(workLiveNetworkValueQ8),
    liveNetworkValueBeforeEventQ8: workConfirmNetworkValueQ8.toString(),
    liveNetworkValueBeforeEventSats:
      q8ToCanonicalDecimal(workConfirmNetworkValueQ8),
    networkValueBeforeEventQ8: workConfirmNetworkValueQ8.toString(),
    networkValueBeforeEventSats:
      q8ToCanonicalDecimal(workConfirmNetworkValueQ8),
    tokenId:
      "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    txid: "8".repeat(64),
  };
  assert.ok(
    workLiveValueQ8 / BOND_VALUE_Q8_SCALE >
      BigInt(Number.MAX_SAFE_INTEGER),
  );
  const exactWorkSummary = summaryPayloads(
    unsafeActual,
    unsafeSupply.toString(),
  );
  exactWorkSummary.workSummary = {
    floor: {
      liveFloorSats: q8ToCanonicalDecimal(workLiveFloorQ8),
    },
    token: { stats: { confirmedTransfers: 1 } },
    workTransferValueProjection: {
      items: [exactWorkProjection],
      model: "canonical-work-transfer-value-projection-v1",
    },
  };
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(exactWorkSummary),
    true,
    "WORK transfer values above 2^53 must reconcile through exact Q8 lanes",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactWorkSummary,
      workSummary: {
        ...exactWorkSummary.workSummary,
        workTransferValueProjection: {
          ...exactWorkSummary.workSummary.workTransferValueProjection,
          items: [
            {
              ...exactWorkProjection,
              liveNetworkValueQ8: (
                workLiveNetworkValueQ8 + 1n
              ).toString(),
              liveNetworkValueSats: q8ToCanonicalDecimal(
                workLiveNetworkValueQ8 + 1n,
              ),
            },
          ],
        },
      },
    }),
    false,
    "one Q8 subunit of WORK projection drift must fail closed",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(
      summaryPayloads(
        {
          ...unsafeActual,
          issuanceFloorQ8: "100000001",
          issuanceFloorSats: "1.00000001",
        },
        unsafeSupply.toString(),
      ),
    ),
    false,
    "the issuance floor must equal integer Q8 division exactly",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(
      summaryPayloads(
        {
          ...unsafeActual,
          issuanceNetworkValueSats: "12692190658411190.82282201",
        },
        unsafeSupply.toString(),
      ),
    ),
    false,
    "an exact Q8 field cannot disagree with its canonical decimal alias",
  );
});

check("canonical summary tip races defer without failing the block worker", () => {
  const canonicalSummaryRefreshCanDefer = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryRefreshCanDefer",
  );
  const tipRace = Object.assign(
    new Error("/api/v1/internal/canonical-summary returned HTTP 503"),
    {
      responseText: JSON.stringify({
        error:
          "The indexed canonical summary checkpoint is not exactly at the Bitcoin Core tip.",
      }),
      statusCode: 503,
    },
  );
  assert.equal(canonicalSummaryRefreshCanDefer(tipRace), true);
  assert.equal(
    canonicalSummaryRefreshCanDefer(
      Object.assign(new Error("database failed"), { statusCode: 503 }),
    ),
    false,
  );
});

check("canonical summary timeouts fail closed unless an eligible prior snapshot exists", async () => {
  const abortError = () =>
    Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
  const priorHash = "a".repeat(64);
  const latestHash = "b".repeat(64);
  let previousPayload = null;
  let insertQueries = 0;
  let canonicalRequestTimeoutMs = null;
  const canonicalSummaryRefreshCanDefer = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryRefreshCanDefer",
  );
  assert.equal(canonicalSummaryRefreshCanDefer(abortError()), true);
  const storeCanonicalSummarySnapshot = isolatedFunction(
    BACKFILL_PATH,
    "storeCanonicalSummarySnapshot",
    {
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 600_000,
      NETWORK: "livenet",
      canonicalSummaryAccountingModelsCurrent: () => true,
      canonicalSummaryCoverage: () => 100,
      canonicalSummaryRefreshCanDefer,
      latestBlockScanCheckpoint: async () => ({
        blockHash: latestHash,
        height: 101,
      }),
      publicLogRelationalFingerprint: async () => ({
        contract: "proof-index-public-log-fingerprint-v1",
        count: 1,
        hash: "f".repeat(64),
        pending: 0,
      }),
      publicLogFingerprintsMatch: (left, right) => left?.hash === right?.hash,
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
      readJson: async (_url, options) => {
        canonicalRequestTimeoutMs = options.timeoutMs;
        throw abortError();
      },
      storedEligibleCanonicalSummarySnapshotPayload: async () =>
        previousPayload,
      unpagedEndpoint: (pathname) => ({ pathname }),
    },
  );
  const client = {
    async query() {
      insertQueries += 1;
      return { rows: [] };
    },
  };

  await rejection(
    storeCanonicalSummarySnapshot(client),
    (error) => error?.name === "AbortError",
    "A cold canonical-summary timeout without an eligible prior snapshot must reject",
  );
  assert.equal(canonicalRequestTimeoutMs, 600_000);
  assert.equal(insertQueries, 0);

  previousPayload = {
    indexedThroughBlockHash: priorHash,
    snapshotId: "eligible-prior-snapshot",
    summaryPayloads: {},
  };
  canonicalRequestTimeoutMs = null;
  const deferred = await storeCanonicalSummarySnapshot(client);
  assert.equal(canonicalRequestTimeoutMs, 600_000);
  assert.equal(deferred.skipped, true);
  assert.equal(deferred.reason, "canonical-summary-deferred");
  assert.equal(deferred.snapshotId, "eligible-prior-snapshot");
  assert.equal(deferred.indexedThroughBlock, 100);
  assert.equal(deferred.latestIndexedHeight, 101);
  assert.equal(insertQueries, 0);
});

check("an Inception summary barrier is exact and cannot defer", async () => {
  const checkpointHash = "d".repeat(64);
  const priorHash = "c".repeat(64);
  let requestedUrl = null;
  const storeCanonicalSummarySnapshot = isolatedFunction(
    BACKFILL_PATH,
    "storeCanonicalSummarySnapshot",
    {
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 600_000,
      canonicalSummaryAccountingModelsCurrent: () => true,
      canonicalSummaryCoverage: () => 100,
      canonicalSummaryRefreshCanDefer: () => true,
      latestBlockScanCheckpoint: async () => ({
        blockHash: checkpointHash,
        height: 101,
      }),
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
      publicLogFingerprintsMatch: () => true,
      publicLogRelationalFingerprint: async () => ({ hash: "f".repeat(64) }),
      readJson: async (url) => {
        requestedUrl = url;
        throw Object.assign(new Error("summary timed out"), {
          name: "AbortError",
        });
      },
      storedEligibleCanonicalSummarySnapshotPayload: async () => ({
        indexedThroughBlockHash: priorHash,
        snapshotId: "prior",
        summaryPayloads: {},
      }),
      unpagedEndpoint: (pathname) =>
        new URL(`http://127.0.0.1:8081${pathname}`),
    },
  );
  await rejection(
    storeCanonicalSummarySnapshot(
      { async query() { return { rows: [] }; } },
      {
        requiredCheckpoint: {
          blockHash: checkpointHash,
          height: 101,
        },
      },
    ),
    (error) => error?.name === "AbortError",
    "A required H-1 summary silently deferred to an older snapshot",
  );
  assert.equal(requestedUrl.searchParams.get("checkpointHeight"), "101");
  assert.equal(
    requestedUrl.searchParams.get("checkpointHash"),
    checkpointHash,
  );

  await rejection(
    storeCanonicalSummarySnapshot(
      { async query() { return { rows: [] }; } },
      {
        requiredCheckpoint: {
          blockHash: "e".repeat(64),
          height: 101,
        },
      },
    ),
    (error) => /does not match required checkpoint/u.test(error.message),
    "A required H-1 hash mismatch reached the summary service",
  );
});

check("only the loopback canonical summary read bypasses Undici", async () => {
  const internalToken = "x".repeat(64);
  const canonicalCalls = [];
  const fetchCalls = [];
  const readJson = isolatedFunction(BACKFILL_PATH, "readJson", {
    AbortController,
    CANONICAL_SUMMARY_RESPONSE_MAX_BYTES: 64 * 1024 * 1024,
    INTERNAL_VERIFIER_TOKEN: internalToken,
    REQUEST_RETRIES: 4,
    REQUEST_TIMEOUT_MS: 60_000,
    clearTimeout,
    fetch: async (url, options) => {
      fetchCalls.push({ options, url });
      return {
        json: async () => ({ source: "fetch" }),
        ok: true,
        status: 200,
      };
    },
    readCanonicalSummaryJsonViaLoopbackHttp: async (url, options) => {
      canonicalCalls.push({ options, url });
      return { source: "node-http" };
    },
    setTimeout,
  });

  const canonical = await readJson(
    new URL(
      "http://127.0.0.1:8081/api/v1/internal/canonical-summary?network=livenet",
    ),
    { retries: 0, timeoutMs: 600_000 },
  );
  assert.equal(canonical.source, "node-http");
  assert.equal(canonicalCalls.length, 1);
  assert.equal(fetchCalls.length, 0);
  assert.equal(canonicalCalls[0].options.maxBytes, 64 * 1024 * 1024);
  assert.equal(
    canonicalCalls[0].options.headers["X-PoW-Internal-Verifier"],
    internalToken,
  );
  assert.ok(canonicalCalls[0].options.signal instanceof AbortSignal);

  const ipv6Canonical = await readJson(
    new URL("http://[::1]:8081/api/v1/internal/canonical-summary"),
    { retries: 0, timeoutMs: 600_000 },
  );
  assert.equal(ipv6Canonical.source, "node-http");
  assert.equal(canonicalCalls.length, 2);
  assert.equal(fetchCalls.length, 0);

  const otherInternal = await readJson(
    new URL(
      "http://127.0.0.1:8081/api/v1/internal/token-verifier?network=livenet",
    ),
    { retries: 0, timeoutMs: 1_000 },
  );
  assert.equal(otherInternal.source, "fetch");
  assert.equal(canonicalCalls.length, 2);
  assert.equal(fetchCalls.length, 1);
  assert.equal(
    fetchCalls[0].options.headers["X-PoW-Internal-Verifier"],
    internalToken,
  );
});

check("canonical summary node:http waits for headers under the caller abort budget", async () => {
  let capturedOptions = null;
  let ended = false;
  const readCanonicalSummaryJsonViaLoopbackHttp = isolatedFunction(
    BACKFILL_PATH,
    "readCanonicalSummaryJsonViaLoopbackHttp",
    {
      Buffer,
      CANONICAL_SUMMARY_RESPONSE_MAX_BYTES: 64 * 1024 * 1024,
      httpRequest: (_url, options, onResponse) => {
        capturedOptions = options;
        const request = new EventEmitter();
        request.destroy = () => {};
        request.end = () => {
          ended = true;
          setImmediate(() => {
            const body = Buffer.from('{"ok":true}', "utf8");
            const response = new EventEmitter();
            response.destroy = () => {};
            response.complete = true;
            response.headers = { "content-length": String(body.length) };
            response.resume = () => {};
            response.statusCode = 200;
            onResponse(response);
            setImmediate(() => {
              response.emit("data", body);
              response.emit("end");
            });
          });
        };
        return request;
      },
    },
  );
  const controller = new AbortController();
  const result = await readCanonicalSummaryJsonViaLoopbackHttp(
    new URL("http://127.0.0.1:8081/api/v1/internal/canonical-summary"),
    {
      headers: { "X-PoW-Internal-Verifier": "x".repeat(64) },
      signal: controller.signal,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(ended, true);
  assert.equal(capturedOptions.agent, false);
  assert.equal(capturedOptions.method, "GET");
  assert.equal(capturedOptions.signal, controller.signal);
  assert.equal(
    capturedOptions.headers["X-PoW-Internal-Verifier"],
    "x".repeat(64),
  );
  assert.equal("timeout" in capturedOptions, false);
  assert.equal("headersTimeout" in capturedOptions, false);
});

check("canonical summary node:http preserves status semantics and caps bodies", async () => {
  const responses = [];
  const readCanonicalSummaryJsonViaLoopbackHttp = isolatedFunction(
    BACKFILL_PATH,
    "readCanonicalSummaryJsonViaLoopbackHttp",
    {
      Buffer,
      CANONICAL_SUMMARY_RESPONSE_MAX_BYTES: 64 * 1024 * 1024,
      httpRequest: (_url, _options, onResponse) => {
        const request = new EventEmitter();
        request.destroy = () => {};
        request.end = () => {
          const spec = responses.shift();
          queueMicrotask(() => {
            const response = new EventEmitter();
            response.destroy = () => {};
            response.headers = spec.headers ?? {};
            response.resume = () => {
              spec.resumed = true;
            };
            response.statusCode = spec.statusCode;
            response.complete = spec.complete ?? spec.end !== false;
            onResponse(response);
            for (const chunk of spec.chunks ?? []) {
              response.emit("data", chunk);
            }
            if (spec.end !== false) {
              response.emit("end");
            }
            if (spec.close === true) {
              response.emit("close");
            }
          });
        };
        return request;
      },
    },
  );
  const url = new URL(
    "http://127.0.0.1:8081/api/v1/internal/canonical-summary",
  );

  responses.push({
    chunks: [],
    headers: { "content-length": "9" },
    statusCode: 200,
  });
  const declaredTooLarge = await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 8 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_TOO_LARGE",
  );
  assert.equal(declaredTooLarge.maxBytes, 8);
  assert.equal(declaredTooLarge.receivedBytes, 9);

  responses.push({
    chunks: [Buffer.from("12345"), Buffer.from("6789")],
    statusCode: 200,
  });
  const streamedTooLarge = await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 8 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_TOO_LARGE",
  );
  assert.equal(streamedTooLarge.receivedBytes, 9);

  responses.push({
    chunks: [Buffer.from("truncated")],
    close: true,
    complete: false,
    end: false,
    statusCode: 200,
  });
  await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 1_024 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_INCOMPLETE",
  );

  responses.push({
    chunks: [Buffer.from("ended-but-incomplete")],
    complete: false,
    statusCode: 200,
  });
  await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 1_024 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_INCOMPLETE",
  );

  const errorBody = '{"error":"still building"}';
  responses.push({
    chunks: [Buffer.from(errorBody)],
    headers: { "content-length": String(Buffer.byteLength(errorBody)) },
    statusCode: 503,
  });
  const httpError = await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 1_024 }),
    (error) => error?.statusCode === 503,
  );
  assert.equal(httpError.message, `${url.pathname} returned HTTP 503`);
  assert.equal(httpError.responseText, errorBody);

  const notFound = {
    chunks: [Buffer.from("not found")],
    headers: { "content-length": "9" },
    statusCode: 404,
  };
  responses.push(notFound);
  const allowed = await readCanonicalSummaryJsonViaLoopbackHttp(url, {
    allowNotFound: true,
    maxBytes: 9,
  });
  assert.equal(Array.isArray(allowed.items), true);
  assert.equal(allowed.items.length, 0);

  responses.push({
    chunks: [],
    headers: { "content-length": "10" },
    statusCode: 404,
  });
  await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, {
      allowNotFound: true,
      maxBytes: 9,
    }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_TOO_LARGE",
  );
});

check("the canonical summary publisher rejects mixed snapshot identities", async () => {
  const objectPayload = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const numberOrNull = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  const requiredKeys = [
    "growthSummary",
    "inceptionSummary",
    "infinitySummary",
    "marketplaceSummary",
    "workFloor",
    "workSummary",
  ];
  const summaryPayloadConservativeCoverage = isolatedFunction(
    BACKFILL_PATH,
    "summaryPayloadConservativeCoverage",
    { numberOrNull, objectPayload },
  );
  const canonicalSummaryCoverage = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryCoverage",
    {
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      summaryPayloadConservativeCoverage,
    },
  );
  const canonicalSummaryAccountingModelsCurrent = () => true;
  const summaryFor = (key, snapshotId = "one-snapshot") => ({
    indexedThroughBlock: 101,
    snapshotId,
    ...(key === "workSummary"
      ? { floor: { indexedThroughBlock: 101 } }
      : key === "growthSummary" || key === "marketplaceSummary"
        ? { workFloor: { indexedThroughBlock: 101 } }
        : {}),
  });
  let writes = 0;
  const storeCanonicalSummarySnapshot = isolatedFunction(
    BACKFILL_PATH,
    "storeCanonicalSummarySnapshot",
    {
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 600_000,
      NETWORK: "livenet",
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      canonicalSummaryAccountingModelsCurrent,
      canonicalSummaryCoverage,
      createHash,
      latestBlockScanCheckpoint: async () => ({ height: 101 }),
      numberOrNull,
      objectPayload,
      publicLogRelationalFingerprint: async () => ({
        contract: "proof-index-public-log-fingerprint-v1",
        count: 1,
        hash: "f".repeat(64),
        pending: 0,
      }),
      publicLogFingerprintsMatch: (left, right) => left?.hash === right?.hash,
      readJson: async () => ({
        indexedThroughBlock: 101,
        ledger: {
          indexedThroughBlock: 101,
          metrics: { indexedThroughBlock: 101 },
          ok: true,
          snapshotId: "one-snapshot",
          status: "consistent",
        },
        snapshotId: "one-snapshot",
        summaryPayloads: Object.fromEntries(
          requiredKeys.map((key) => [
            key,
            summaryFor(key, key === "infinitySummary" ? "mixed" : undefined),
          ]),
        ),
      }),
      storedEligibleCanonicalSummarySnapshotPayload: async () => null,
      storedLedgerSnapshotPayload: async () => ({}),
      summaryPayloadSnapshotId: (payload) => String(payload?.snapshotId ?? ""),
      summaryPayloadsWithAlignedWorkFloor: (payload) => payload,
      summarySnapshotTotals: () => ({}),
      unpagedEndpoint: (pathname) => ({ pathname }),
    },
  );
  await rejection(
    storeCanonicalSummarySnapshot({
      async query() {
        writes += 1;
        return { rows: [] };
      },
    }),
    (error) => /not one exact snapshot/u.test(error.message),
  );
  assert.equal(writes, 0);
});

check("exact canonical summaries require current conserved token balances", async () => {
  const tokenTablePayloadHasConservedBalances = isolatedFunction(
    API_PATH,
    "tokenTablePayloadHasConservedBalances",
  );
  const tokenId = "a".repeat(64);
  const conserved = {
    holders: [
      { address: "alice", balance: 600, tokenId },
      { address: "bob", balance: 400, tokenId },
    ],
    mints: [
      { amount: 600, confirmed: true, tokenId },
      { amount: 400, confirmed: true, tokenId },
    ],
    tokens: [{ tokenId }],
  };
  assert.equal(tokenTablePayloadHasConservedBalances(conserved), true);
  assert.equal(
    tokenTablePayloadHasConservedBalances({ ...conserved, holders: [] }),
    false,
  );
  assert.equal(
    tokenTablePayloadHasConservedBalances({
      ...conserved,
      holders: [{ address: "alice", balance: 999, tokenId }],
    }),
    false,
  );
  const orphanTokenId = "b".repeat(64);
  assert.equal(
    tokenTablePayloadHasConservedBalances({
      ...conserved,
      holders: [
        ...conserved.holders,
        { address: "mallory", balance: 100, tokenId: orphanTokenId },
      ],
      mints: [
        ...conserved.mints,
        { amount: 100, confirmed: true, tokenId: orphanTokenId },
      ],
    }),
    false,
  );
  const fractionalWork = {
    confirmedSupply: "1.00000001",
    confirmedSupplyAtoms: "100000001",
    holders: [
      {
        address: "alice",
        balance: "0.5",
        balanceAtoms: "50000000",
        tokenId: WORK_TOKEN_ID,
      },
      {
        address: "bob",
        balance: "0.50000001",
        balanceAtoms: "50000001",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    mints: [
      {
        amount: "1.00000001",
        amountAtoms: "100000001",
        confirmed: true,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    tokens: [
      {
        confirmedSupply: "1.00000001",
        confirmedSupplyAtoms: "100000001",
        tokenId: WORK_TOKEN_ID,
      },
    ],
  };
  assert.equal(
    tokenTablePayloadHasConservedBalances(fractionalWork),
    true,
  );
  assert.equal(
    tokenTablePayloadHasConservedBalances({
      ...fractionalWork,
      holders: fractionalWork.holders.map((holder, index) =>
        index === 1 ? { ...holder, balanceAtoms: "50000000" } : holder,
      ),
    }),
    false,
  );
  assert.equal(
    tokenTablePayloadHasConservedBalances({
      ...fractionalWork,
      confirmedSupplyAtoms: "0100000001",
    }),
    false,
  );

  let requestedHeight = 0;
  let tablePayload = null;
  const exactTokenTablePayloadForCanonicalLedger = isolatedFunction(
    API_PATH,
    "exactTokenTablePayloadForCanonicalLedger",
    {
      currentProofIndexTokenTablePayloadForLedger: async (
        _network,
        _label,
        options,
      ) => {
        requestedHeight = options.exactHeight;
        return tablePayload;
      },
      freshDataUnavailableError: (message) => new Error(message),
      tokenTablePayloadHasConservedBalances,
    },
  );
  await rejection(
    exactTokenTablePayloadForCanonicalLedger("livenet", "fixture", 101),
    (error) => /exact conserved token balances are unavailable/u.test(error.message),
  );
  assert.equal(requestedHeight, 101);
  await rejection(
    exactTokenTablePayloadForCanonicalLedger("livenet", "fixture", 0),
    (error) => /exact positive token-table checkpoint/u.test(error.message),
  );
  tablePayload = conserved;
  assert.equal(
    await exactTokenTablePayloadForCanonicalLedger("livenet", "fixture", 102),
    conserved,
  );
  assert.equal(requestedHeight, 102);
});

check("exact stored bond snapshots serve stable and fresh reads before recovery", async () => {
  const requestSource = topLevelFunctionSource(API_PATH, "handleRequest");
  const workSource = topLevelFunctionSource(API_PATH, "workSummaryPayload");
  const marketplaceSource = topLevelFunctionSource(
    API_PATH,
    "livenetMarketplaceSummaryPayload",
  );
  const bondSummarySource = topLevelFunctionSource(
    API_PATH,
    "bondSummaryPayload",
  );
  const growthSource = topLevelFunctionSource(API_PATH, "growthSummaryPayload");
  const workRouteStart = requestSource.indexOf(
    'if (url.pathname === "/api/v1/work-summary")',
  );
  const workRouteEnd = requestSource.indexOf(
    'if (url.pathname === "/api/v1/marketplace-summary")',
    workRouteStart,
  );
  const exactInfinitySummaryRead = bondSummarySource.indexOf(
    "currentProofIndexSummarySnapshotFallbackPayload",
  );
  const relationalInfinitySummaryRead = bondSummarySource.indexOf(
    "proofIndexBondSummaryPayload",
  );
  assert.ok(workRouteStart >= 0);
  assert.ok(workRouteEnd > workRouteStart);
  assert.ok(exactInfinitySummaryRead >= 0);
  assert.ok(relationalInfinitySummaryRead > exactInfinitySummaryRead);
  assert.match(
    bondSummarySource,
    /if \(network === "livenet"\)[\s\S]*currentProofIndexSummarySnapshotFallbackPayload/u,
  );
  const workRouteSource = requestSource.slice(workRouteStart, workRouteEnd);

  assert.doesNotMatch(workRouteSource, /fastLivenetWorkSummaryPayload/u);
  assert.match(
    workRouteSource,
    /workSummaryPayload\(network,\s*freshRead\)/u,
  );
  assert.ok(
    workSource.indexOf("currentProofIndexSummarySnapshotFallbackPayload") <
      workSource.indexOf("summaryCanonicalLedgerPayload"),
  );
  assert.ok(
    marketplaceSource.indexOf(
      "currentProofIndexMarketplaceSummaryFallbackPayload",
    ) < marketplaceSource.indexOf("if (!fresh)"),
  );
  assert.ok(
    growthSource.indexOf("currentProofIndexSummarySnapshotFallbackPayload") <
      growthSource.indexOf("summaryCanonicalLedgerPayload"),
  );

  const canonicalInfinity = { snapshotId: "canonical-infinity" };
  const relationalInfinity = { snapshotId: "relational-infinity" };
  let exactInfinity = canonicalInfinity;
  let exactInfinityReads = 0;
  let relationalInfinityReads = 0;
  let canonicalLedgerReads = 0;
  let currentLedger = null;
  const relationalLedgers = [];
  const readBondSummary = isolatedFunction(
    API_PATH,
    "bondSummaryPayload",
    {
      LEDGER_SUMMARY_FRESH_WAIT_MS: 1_000,
      bondSummaryFromCanonicalLedger: async () => null,
      currentProofIndexSummarySnapshotFallbackPayload: async () => {
        exactInfinityReads += 1;
        return exactInfinity;
      },
      existingCurrentCanonicalLedgerPayloadWithinMs: async () => currentLedger,
      freshDataUnavailableError: (message) => new Error(message),
      numericValue: (value) => Number(value) || 0,
      payloadWithFallbackAfterMs: async (promise, fallback) =>
        (await promise) ?? fallback,
      proofIndexBondSummaryPayload: async (_network, _fresh, _config, ledger) => {
        relationalInfinityReads += 1;
        relationalLedgers.push(ledger);
        return relationalInfinity;
      },
      standaloneBondSummaryPayload: async () => null,
      summaryCanonicalLedgerPayload: async () => {
        canonicalLedgerReads += 1;
        return { marker: "fresh-ledger" };
      },
    },
  );
  const infinityConfig = {
    displayName: "Infinity Bond",
    summaryKey: "infinitySummary",
    summaryRoute: "infinity-summary",
  };
  assert.equal(
    await readBondSummary("livenet", false, infinityConfig),
    canonicalInfinity,
  );
  assert.equal(
    await readBondSummary("livenet", true, infinityConfig),
    canonicalInfinity,
  );
  assert.equal(exactInfinityReads, 2);
  assert.equal(relationalInfinityReads, 0);
  assert.equal(canonicalLedgerReads, 0);
  exactInfinity = null;
  assert.equal(
    await readBondSummary("livenet", false, infinityConfig),
    relationalInfinity,
  );
  assert.equal(
    await readBondSummary("livenet", true, infinityConfig),
    relationalInfinity,
  );
  assert.equal(exactInfinityReads, 4);
  assert.equal(relationalInfinityReads, 2);
  assert.equal(canonicalLedgerReads, 1);
  assert.equal(relationalLedgers[0], null);
  assert.equal(relationalLedgers[1]?.marker, "fresh-ledger");
  currentLedger = { marker: "exact-current-ledger" };
  assert.equal(
    await readBondSummary("livenet", true, infinityConfig),
    relationalInfinity,
  );
  assert.equal(exactInfinityReads, 5);
  assert.equal(canonicalLedgerReads, 1);
  assert.equal(relationalLedgers[2]?.marker, "exact-current-ledger");
});

check("exact listing misses bypass chain recovery only with terminal database proof", async () => {
  const txid = "6".repeat(64);
  let terminal = true;
  const sqlReads = [];
  const pool = {
    async query(sql) {
      sqlReads.push(sql);
      if (sql.includes("AS terminal")) {
        return { rows: [{ terminal }] };
      }
      return { rows: [{ indexed_at: null, total_count: 0 }] };
    },
  };
  const exactActiveTokenListingHistoryPage = isolatedFunction(
    READER_PATH,
    "exactActiveTokenListingHistoryPage",
    {
      activeTokenListingHistoryItem: () => true,
      compareTokenHistoryMarketItems: () => 0,
      dateIso: (value) => value ?? "2026-07-13T00:00:00.000Z",
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "")) ? String(value) : "",
      rowNumber: (row, key) => Number(row?.[key]) || 0,
      tokenHistoryFilterNeedles: () => [txid],
      tokenHistoryPageFromItems: (options) => ({
        indexedThroughBlock: options.indexedThroughBlock,
        items: options.items,
        snapshotId: options.snapshot?.snapshot_id,
        source: options.source,
        totalCount: options.items.length,
      }),
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const pagination = { limit: 20, offset: 0, query: txid };
  const snapshot = {
    generated_at: "2026-07-13T00:00:00.000Z",
    indexed_through_block: 957913,
    snapshot_id: "current",
  };
  const terminalPage = await exactActiveTokenListingHistoryPage(
    pool,
    "livenet",
    "work",
    new URLSearchParams({ q: txid }),
    pagination,
    snapshot,
  );
  assert.equal(terminalPage.totalCount, 0);
  assert.equal(terminalPage.indexedThroughBlock, 957913);
  assert.equal(terminalPage.source, "proof-indexer-credit-listings-terminal");
  assert.match(sqlReads[0], /cl\.sale_ticket_txid = ANY/u);
  assert.match(sqlReads[0], /cl\.seal_txid = ANY/u);
  assert.match(sqlReads[0], /cl\.close_txid = ANY/u);
  assert.match(sqlReads[1], /terminal_tx\.status IN \('dropped', 'orphaned'\)/u);

  terminal = false;
  sqlReads.length = 0;
  assert.equal(
    await exactActiveTokenListingHistoryPage(
      pool,
      "livenet",
      "work",
      new URLSearchParams({ q: txid }),
      pagination,
      snapshot,
    ),
    null,
  );
  assert.equal(sqlReads.length, 2);

  const readerSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexTokenHistoryPayload",
  );
  assert.ok(
    readerSource.indexOf("exactActiveTokenListingHistoryPage") <
      readerSource.indexOf("proofIndexTokenMarketHistoryOverlayPayload"),
  );
});

check("exact Log txid reads use indexed refs and trust an exact empty page", async () => {
  const txid = "7".repeat(64);
  const queryReads = [];
  const proofIndexLogHistoryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexLogHistoryPayload",
    {
      PUBLIC_LOG_EVENT_KINDS: new Set(["token-mint"]),
      dateIso: (value) => value,
      eventKindSqlCondition: (kind, addValue) =>
        `e.kind = ${addValue(kind)}`,
      indexedThroughBlockFromItems: () => undefined,
      ledgerSnapshotMetadata: async () => ({
        generated_at: "2026-07-13T00:00:00.000Z",
        indexed_through_block: 957913,
        snapshot_id: "current",
      }),
      logHistoryPageFromItems: (options) => ({
        indexedThroughBlock: options.indexedThroughBlock,
        items: options.items,
        source: options.source,
        totalCount: options.items.length,
      }),
      normalizeHistoryEventRows: (rows) => rows,
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "")) ? String(value) : "",
      proofIndexLogHistoryReadEligibility: () => ({
        pagination: {
          limit: 5,
          offset: 0,
          query: txid,
          snapshotId: "",
        },
      }),
      proofIndexPool: () => ({
        async query(sql, params) {
          queryReads.push({ params, sql });
          if (sql.includes("invalid_event_count")) {
            assert.match(
              sql,
              /candidate\.status = 'pending'[\s\S]*terminal_tx\.status <> 'confirmed'/u,
            );
            return {
              rows: [{
                block_height: 955618,
                event_count: 1,
                has_raw_tx: true,
                invalid_event_count: 1,
                public_event_count: 0,
                status: "confirmed",
              }],
            };
          }
          return { rows: [] };
        },
      }),
      rowNumber: (row, key) => Number(row?.[key]) || 0,
    },
  );
  const result = await proofIndexLogHistoryPayload(
    "livenet",
    "",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(result.totalCount, 0);
  assert.equal(result.indexedThroughBlock, 957913);
  assert.equal(result.queryDisposition, "confirmed-invalid-nonpublic");
  assert.match(queryReads[0].sql, /WITH matched_events AS/u);
  assert.match(queryReads[0].sql, /proof_indexer\.event_refs/u);
  assert.match(
    queryReads[0].sql,
    /e\.updated_at <= \$4::timestamptz[\s\S]*e\.block_height <= \$3/u,
  );
  assert.doesNotMatch(queryReads[0].sql, /payload @>/u);
  assert.equal(queryReads[0].params[2], 957913);
  assert.equal(queryReads[0].params[3], "2026-07-13T00:00:00.000Z");
  assert.equal(queryReads[0].params[4], txid);
  assert.match(queryReads[1].sql, /public_event_count/u);
  assert.match(
    queryReads[1].sql,
    /candidate\.block_height = terminal_tx\.block_height/u,
  );
  assert.match(
    queryReads[1].sql,
    /candidate\.status = 'pending'[\s\S]*terminal_tx\.status <> 'confirmed'/u,
  );
  assert.match(
    queryReads[1].sql,
    /terminal_tx\.updated_at <= \$5::timestamptz/u,
  );
  assert.match(
    queryReads[1].sql,
    /canonical_block\.canonical = true[\s\S]*canonical_block\.indexed_at <= \$5/u,
  );
  assert.deepEqual(Array.from(queryReads[1].params.slice(3)), [
    957913,
    "2026-07-13T00:00:00.000Z",
  ]);
  const nonpublicFilter = await proofIndexLogHistoryPayload(
    "livenet",
    "token-event-invalid",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(nonpublicFilter.totalCount, 0);
  assert.equal(nonpublicFilter.queryDisposition, "nonpublic-kind-filter");
  assert.equal(queryReads.length, 3);
  assert.doesNotMatch(
    topLevelFunctionSource(API_PATH, "handleRequest"),
    /shouldUseCanonicalTxidFallback/u,
  );
  assert.match(
    topLevelFunctionSource(API_PATH, "handleRequest"),
    /exactLogHistoryMissPayload/u,
  );
});

check("stable exact Log authenticates only its bounded event membership", async () => {
  const txid = "6".repeat(64);
  const item = {
    confirmed: true,
    eventId: 42,
    kind: "token-transfer",
    network: "livenet",
    txid,
  };
  let page = {
    indexedThroughBlock: 105,
    items: [item],
    snapshotId: "snapshot-105",
    totalCount: 1,
  };
  const membershipReads = [];
  let membershipRestricted = true;
  let resolvedEmptyDisposition = "";
  const definitivePinnedLogQueryDisposition = isolatedFunction(
    API_PATH,
    "definitivePinnedLogQueryDisposition",
  );
  for (const disposition of [
    "confirmed-invalid-nonpublic",
    "confirmed-nonpublic",
    "nonpublic-kind-filter",
    "not-indexed-proof-event",
    "terminal-nonpublic",
  ]) {
    assert.equal(
      definitivePinnedLogQueryDisposition(disposition),
      true,
      `${disposition} must be a definitive authenticated empty Log result`,
    );
  }
  const stableProofIndexLogHistoryPayload = isolatedFunction(
    API_PATH,
    "stableProofIndexLogHistoryPayload",
    {
      activityKey: (candidate) =>
        [
          candidate?.kind,
          candidate?.network,
          candidate?.txid,
          candidate?.listingId ?? "",
          candidate?.id ?? "",
        ].join(":"),
      definitivePinnedLogQueryDisposition,
      exactLogHistoryMissPayload: async (indexedPayload) => ({
        ...indexedPayload,
        ...(resolvedEmptyDisposition
          ? { queryDisposition: resolvedEmptyDisposition }
          : {}),
      }),
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      payloadIndexedThroughBlockHash: (payload) =>
        payload?.indexedThroughBlockHash ?? "",
      payloadSnapshotId: (payload) => payload?.snapshotId ?? "",
      proofIndexCanonicalActivityPayload: async (_network, options) => {
        membershipReads.push(options);
        return {
          activity: [item],
          canonicalMinerFeeCoverage: {
            complete: true,
            confirmedEvents: 1,
            confirmedTransactions: 1,
            coveredConfirmedEvents: 1,
            coveredConfirmedTransactions: 1,
            missingConfirmedEvents: 0,
            missingConfirmedTransactions: 0,
            missingConfirmedTxids: [],
            source: "proof-indexer-normalized-input-output-totals",
          },
          indexedThroughBlock: 105,
          membershipEventIds: [42],
          membershipRestricted,
          snapshotId: "snapshot-105",
        };
      },
      proofIndexLogHistoryPayload: async () => page,
      proofIndexLogHistoryReadEligibility: () => ({
        pagination: { query: txid, snapshotId: "" },
      }),
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock) || 0,
      stableCanonicalLogSummaryPayload: async () => ({
        indexedThroughBlock: 105,
        indexedThroughBlockHash: "a".repeat(64),
        snapshotId: "snapshot-105",
        stats: { total: 10 },
        totalCount: 10,
      }),
      verifiedCanonicalMinerFeeCoverage: (coverage) =>
        coverage?.complete === true ? coverage : null,
      verifyStableLogCheckpointAfterRead: async () => ({ exact: true }),
    },
  );

  const result = await stableProofIndexLogHistoryPayload(
    "livenet",
    "",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(result.items[0].eventId, 42);
  assert.equal(membershipReads.length, 1);
  assert.equal(membershipReads[0].snapshotId, "snapshot-105");
  assert.deepEqual(Array.from(membershipReads[0].eventIds), [42]);

  membershipRestricted = false;
  const outsideError = await rejection(
    stableProofIndexLogHistoryPayload(
      "livenet",
      "",
      new URLSearchParams({ q: txid }),
    ),
    (candidate) =>
      candidate?.details?.code ===
        "CANONICAL_LOG_EXACT_QUERY_OUTSIDE_SNAPSHOT",
  );
  assert.equal(outsideError.statusCode, 503);

  page = {
    ...page,
    items: [],
    queryDisposition: "confirmed-invalid-nonpublic",
    totalCount: 0,
  };
  const readsBeforeEmpty = membershipReads.length;
  const empty = await stableProofIndexLogHistoryPayload(
    "livenet",
    "",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(empty.queryDisposition, "confirmed-invalid-nonpublic");
  assert.equal(membershipReads.length, readsBeforeEmpty);

  for (const disposition of [
    "nonpublic-kind-filter",
    "not-indexed-proof-event",
    "terminal-nonpublic",
  ]) {
    page = { ...page, queryDisposition: disposition };
    const definitiveEmpty = await stableProofIndexLogHistoryPayload(
      "livenet",
      "",
      new URLSearchParams({ q: txid }),
    );
    assert.equal(definitiveEmpty.queryDisposition, disposition);
    assert.equal(membershipReads.length, readsBeforeEmpty);
  }

  page = { ...page, queryDisposition: undefined };
  resolvedEmptyDisposition = "not-indexed-proof-event";
  const resolvedEmpty = await stableProofIndexLogHistoryPayload(
    "livenet",
    "",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(resolvedEmpty.queryDisposition, "not-indexed-proof-event");

  resolvedEmptyDisposition = "";
  const missingError = await rejection(
    stableProofIndexLogHistoryPayload(
      "livenet",
      "",
      new URLSearchParams({ q: txid }),
    ),
    (candidate) =>
      candidate?.details?.code === "CANONICAL_LOG_EXACT_QUERY_NOT_IN_SNAPSHOT",
  );
  assert.equal(missingError.statusCode, 503);
});

check("ambiguous exact Log misses fail fast instead of scanning all history", async () => {
  let indexedStatus = null;
  let statusFailure = null;
  let timeout = false;
  const exactLogHistoryMissPayload = isolatedFunction(
    API_PATH,
    "exactLogHistoryMissPayload",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      payloadWithFallbackAfterMs: async (promise, fallback) =>
        timeout ? fallback : await promise,
      proofIndexTxStatusPayload: async () => {
        if (statusFailure) {
          throw statusFailure;
        }
        return indexedStatus;
      },
    },
  );
  const txid = "8".repeat(64);
  const emptyPage = { items: [], totalCount: 0 };
  assert.equal(
    (
      await exactLogHistoryMissPayload(
        emptyPage,
        "livenet",
        txid,
      )
    ).queryDisposition,
    "not-indexed-proof-event",
  );
  indexedStatus = { status: "dropped" };
  assert.equal(
    (
      await exactLogHistoryMissPayload(
        emptyPage,
        "livenet",
        txid,
      )
    ).queryDisposition,
    "terminal-nonpublic",
  );
  indexedStatus = { status: "confirmed" };
  const error = await rejection(
    exactLogHistoryMissPayload(emptyPage, "livenet", txid),
    (candidate) => candidate?.statusCode === 503,
  );
  assert.equal(error.details.code, "CANONICAL_LOG_PROJECTION_MISSING");

  indexedStatus = null;
  statusFailure = new Error("database unavailable");
  const failedDisposition = await rejection(
    exactLogHistoryMissPayload(emptyPage, "livenet", txid),
    (candidate) => candidate?.statusCode === 503,
  );
  assert.equal(
    failedDisposition.details.code,
    "CANONICAL_LOG_TX_DISPOSITION_UNAVAILABLE",
  );

  statusFailure = null;
  timeout = true;
  const timedOutDisposition = await rejection(
    exactLogHistoryMissPayload(emptyPage, "livenet", txid),
    (candidate) => candidate?.statusCode === 503,
  );
  assert.equal(
    timedOutDisposition.details.code,
    "CANONICAL_LOG_TX_DISPOSITION_UNAVAILABLE",
  );
});

check("transaction status trusts only canonical block-backed confirmations", async () => {
  let row = {
    block_canonical: true,
    block_hash: "a".repeat(64),
    block_height: 123,
    block_time: "2026-07-14T00:00:00.000Z",
    canonical_scan_proof: true,
    first_seen_at: "2026-07-13T23:55:00.000Z",
    status: "confirmed",
    txid: "1".repeat(64),
    updated_at: "2026-07-14T00:00:00.000Z",
  };
  const readStatus = isolatedFunction(
    READER_PATH,
    "proofIndexTxStatusPayload",
    {
      BITCOIN_GENESIS_TIME_MS: Date.UTC(2009, 0, 3, 18, 15, 5),
      dateIso: (value) => new Date(value).toISOString(),
      normalizedStatus: (value) => String(value ?? "").toLowerCase(),
      proofIndexPool: () => ({
        async query() {
          return { rows: row ? [row] : [] };
        },
      }),
    },
  );

  const confirmedStatus = await readStatus(row.txid, "livenet");
  assert.equal(confirmedStatus?.status, "confirmed");
  assert.equal(confirmedStatus?.contract, "proof-of-work-tx-status-v2");
  assert.equal(confirmedStatus?.canonical, true);
  assert.equal(confirmedStatus?.blockHash, "a".repeat(64));
  assert.equal(confirmedStatus?.blockHeight, 123);
  assert.equal(confirmedStatus?.blockTime, "2026-07-14T00:00:00.000Z");
  row = { ...row, block_height: null };
  assert.equal(await readStatus(row.txid, "livenet"), null);
  row = { ...row, block_height: 123, block_canonical: false };
  assert.equal(await readStatus(row.txid, "livenet"), null);
  row = {
    ...row,
    block_canonical: true,
    block_hash: null,
    block_height: null,
    block_time: null,
    canonical_scan_proof: false,
    status: "pending",
  };
  assert.equal(await readStatus(row.txid, "livenet"), null);
  const pendingStatus = await readStatus(row.txid, "livenet", {
    includeUnconfirmed: true,
  });
  assert.equal(pendingStatus?.status, "pending");
  assert.equal(pendingStatus?.mempoolSeen, true);
  assert.equal(
    pendingStatus?.mempoolFirstSeenAt,
    "2026-07-13T23:55:00.000Z",
  );
});

check("authoritative transaction status distinguishes proof from dependency failure", async () => {
  const txid = "1".repeat(64);
  const blockHash = "a".repeat(64);
  const unavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const confirmedStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction") {
          return {
            ok: true,
            result: { blockhash: blockHash, confirmations: 2, txid },
          };
        }
        if (method === "getblockheader") {
          return {
            ok: true,
            result: {
              confirmations: 2,
              hash: blockHash,
              height: 123,
              time: 1_783_000_000,
            },
          };
        }
        if (method === "getblock") {
          return {
            ok: true,
            result: { hash: blockHash, height: 123, tx: [txid] },
          };
        }
        if (method === "getblockhash") {
          return { ok: true, result: blockHash };
        }
        assert.fail(`unexpected RPC method ${method}`);
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const confirmed = await confirmedStatus(txid, "livenet");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.canonical, true);
  assert.equal(confirmed.blockHash, blockHash);
  assert.equal(confirmed.blockHeight, 123);
  assert.equal(confirmed.contract, "proof-of-work-tx-status-v2");

  const pendingStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) =>
        method === "getrawtransaction"
          ? { ok: true, result: { confirmations: 0, txid } }
          : { ok: true, result: { time: 1_783_000_000 } },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const pending = await pendingStatus(txid, "livenet");
  assert.equal(pending.status, "pending");
  assert.equal(pending.mempoolSeen, true);
  assert.equal(
    pending.mempoolFirstSeenAt,
    new Date(1_783_000_000_000).toISOString(),
  );

  const absentStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction" || method === "getmempoolentry") {
          return { error: { code: -5 }, ok: false };
        }
        if (method === "getindexinfo") {
          return {
            ok: true,
            result: {
              txindex: { best_block_height: 123, synced: true },
            },
          };
        }
        return {
          ok: true,
          result: {
            blocks: 123,
            chain: "main",
            headers: 123,
            initialblockdownload: false,
            pruned: false,
            verificationprogress: 1,
          },
        };
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const absent = await absentStatus(txid, "livenet");
  assert.equal(absent.status, "dropped");
  assert.equal(absent.absenceProven, true);

  const missingTxindexStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction" || method === "getmempoolentry") {
          return { error: { code: -5 }, ok: false };
        }
        if (method === "getindexinfo") {
          return { ok: true, result: {} };
        }
        return {
          ok: true,
          result: {
            blocks: 123,
            chain: "main",
            headers: 123,
            initialblockdownload: false,
            pruned: false,
            verificationprogress: 1,
          },
        };
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  await rejection(
    missingTxindexStatus(txid, "livenet"),
    (error) =>
      error.statusCode === 503 && error.details?.code === "TX_STATUS_UNAVAILABLE",
  );

  const unavailableStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async () => {
        throw new Error("rpc timeout");
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const failure = await rejection(
    unavailableStatus(txid, "livenet"),
    (error) =>
      error.statusCode === 503 && error.details?.code === "TX_STATUS_UNAVAILABLE",
  );
  assert.match(failure.message, /lookup failed/iu);
});

check("pending transaction times never turn zero into the Unix epoch", () => {
  const serverTime = isolatedFunction(API_PATH, "tokenTransactionTime");
  const clientTime = isolatedTypeScriptFunction(APP_PATH, "tokenTransactionTime");
  const mempoolSeconds = 1_783_000_000;
  for (const transactionTime of [serverTime, clientTime]) {
    assert.equal(
      transactionTime({
        status: { block_time: 0, mempool_time: mempoolSeconds },
      }),
      mempoolSeconds * 1000,
    );
    assert.ok(transactionTime({ status: { block_time: 0 } }) > 1_230_768_905_000);
  }

  const plausibleTime = isolatedFunction(
    READER_PATH,
    "plausibleBitcoinEventTime",
    { BITCOIN_GENESIS_TIME_MS: Date.UTC(2009, 0, 3, 18, 15, 5) },
  );
  assert.equal(
    plausibleTime(
      "1970-01-01T00:00:00.000Z",
      "2026-07-12T04:11:53.155Z",
    ),
    "2026-07-12T04:11:53.155Z",
  );
});

check("canonical confirmed events reject stale non-confirmed upserts", () => {
  const source = fileSource(BACKFILL_PATH);
  assert.match(
    source,
    /proof_indexer\.events\.status = 'confirmed'[\s\S]*EXCLUDED\.status <> 'confirmed'[\s\S]*canonical_transaction\.raw_tx \? 'canonicalBlockScan'/u,
  );
  assert.match(
    source,
    /if \(result\.rows\.length === 0\)[\s\S]*canonicalConfirmed: true/u,
  );
});

check("event payload status is normalized from the authoritative relational state", () => {
  const itemStatus = isolatedFunction(BACKFILL_PATH, "itemStatus");
  const normalizedEventItem = isolatedFunction(
    BACKFILL_PATH,
    "normalizedEventItem",
    {
      bondTagForKind: (kind) => kind === "inception-bond"
        ? {
            kind: "inception-bond",
            label: "Inception Bond",
            memo: "inception bond",
          }
        : null,
      itemTime: (item) => item.createdAt,
      normalizedBondTags: (tags) => tags ?? [],
      normalizedBondTitle: (item, status) =>
        item.title ?? `Inception Bond ${status}`,
      normalizedText: (value) => String(value ?? "").trim(),
    },
  );
  const stableEventKey = isolatedFunction(BACKFILL_PATH, "stableEventKey", {
    createHash,
  });
  const txid = "a".repeat(64);
  const base = {
    confirmed: true,
    createdAt: "2026-07-14T23:20:00.000Z",
    dropped: true,
    kind: "inception-bond",
    status: "pending",
    txid,
  };
  const cases = [
    ["pending", true, true, false, false],
    ["confirmed", false, true, true, false],
    ["dropped", true, false, false, true],
    ["orphaned", true, true, false, false],
  ];
  const eventKeys = [];
  for (const [status, incomingConfirmed, incomingDropped, confirmed, dropped]
    of cases) {
    const incoming = {
      ...base,
      confirmed: incomingConfirmed,
      dropped: incomingDropped,
      status,
    };
    const authoritativeStatus = itemStatus(incoming);
    const normalized = normalizedEventItem(
      incoming,
      "inception-bond",
      authoritativeStatus,
    );
    assert.equal(normalized.status, status);
    assert.equal(normalized.confirmed, confirmed);
    assert.equal(normalized.dropped, dropped);
    assert.equal(incoming.confirmed, incomingConfirmed);
    assert.equal(incoming.dropped, incomingDropped);
    eventKeys.push(stableEventKey({
      item: normalized,
      kind: "inception-bond",
      protocol: "pwm1",
      sourceLabel: "address-mail",
      txid,
    }));
  }
  assert.deepEqual(
    eventKeys,
    Array(cases.length).fill(`pwm1:inception-bond:${txid}`),
  );
});

check("confirmed event replay repairs stale pending payload status", async () => {
  const itemStatus = isolatedFunction(BACKFILL_PATH, "itemStatus");
  const normalizedEventItem = isolatedFunction(
    BACKFILL_PATH,
    "normalizedEventItem",
    {
      bondTagForKind: () => null,
      itemTime: (item) => item.createdAt,
    },
  );
  const stableEventKey = isolatedFunction(BACKFILL_PATH, "stableEventKey", {
    createHash,
  });
  const txid = "b".repeat(64);
  const eventWrites = [];
  const projected = [];
  let storedPayload = {
    confirmed: true,
    dropped: true,
    kind: "inception-bond",
    status: "pending",
    txid,
  };
  const client = {
    async query(sql, params) {
      const text = String(sql);
      if (/INSERT INTO proof_indexer\.events/iu.test(text)) {
        const incoming = JSON.parse(params[14]);
        storedPayload = { ...storedPayload, ...incoming };
        eventWrites.push({ params, sql: text });
        return {
          rows: [{
            event_id: "canonical-event",
            payload: storedPayload,
            status: params[5],
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const upsertEvent = isolatedFunction(BACKFILL_PATH, "upsertEvent", {
    NETWORK: "livenet",
    amountSats: () => 0,
    dataBytes: () => 0,
    eventKind: (item) => item.kind,
    itemStatus,
    itemTime: (item) => item.createdAt,
    itemTxid: (item) => item.txid,
    normalizedEventItem,
    numberOrNull: (value) => Number.isFinite(Number(value))
      ? Number(value)
      : null,
    participantsForItem: () => [],
    protocolForItem: () => "pwm1",
    refsForItem: () => [],
    stableEventKey,
    stableEventKeyKind: (_item, kind) => kind,
    upsertProjection: async (_client, _sourceLabel, item, status) => {
      projected.push({ item, status });
    },
    upsertTransaction: async () => {},
  });

  await upsertEvent(client, "address-mail", {
    blockHeight: 958_076,
    confirmed: true,
    createdAt: "2026-07-14T23:25:00.000Z",
    kind: "inception-bond",
    txid,
  });

  assert.equal(eventWrites.length, 1);
  assert.equal(eventWrites[0].params[1], `pwm1:inception-bond:${txid}`);
  assert.equal(eventWrites[0].params[5], "confirmed");
  assert.equal(storedPayload.status, "confirmed");
  assert.equal(storedPayload.confirmed, true);
  assert.equal(storedPayload.dropped, false);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].status, "confirmed");
  assert.equal(projected[0].item.status, "confirmed");
  assert.equal(projected[0].item.confirmed, true);
  assert.equal(projected[0].item.dropped, false);
});

check("synthetic bond definitions are not indexed as Bitcoin transactions", () => {
  const powbTokenId =
    "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
  const incbTokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const itemTxid = isolatedFunction(BACKFILL_PATH, "itemTxid", {
    BOND_TOKEN_IDS: new Set([powbTokenId, incbTokenId]),
    isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
  });
  assert.equal(itemTxid({ tokenId: powbTokenId, txid: powbTokenId }), "");
  assert.equal(itemTxid({ tokenId: incbTokenId }), "");
  assert.equal(
    itemTxid({ tokenId: powbTokenId, txid: "9".repeat(64) }),
    "9".repeat(64),
  );
  assert.equal(itemTxid({ tokenId: "8".repeat(64) }), "8".repeat(64));
});

check("Log coverage separates the latest event from the verified checkpoint", async () => {
  const compact = isolatedFunction(API_PATH, "compactActivitySummaryPayload", {
    SUMMARY_ACTIVITY_LIMIT: 10,
    activityStatsFromItems: (_items, stats) => stats,
    indexedThroughBlockFromItems: () => 100,
    recentByCreatedAt: (items) => items,
  });
  const summary = compact(
    {
      activity: [{ blockHeight: 100 }],
      stats: { indexedThroughBlock: 100, total: 1 },
    },
    105,
  );
  assert.equal(summary.stats.latestEventBlock, 100);
  assert.equal(summary.stats.indexedThroughBlock, 105);

  let pageTotal = 1;
  const freshPage = isolatedFunction(
    API_PATH,
    "freshProofIndexLogHistoryPayload",
    {
      activitySummaryPayload: async () => ({ marker: "summary" }),
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      payloadIndexedThroughBlockHash: (payload) =>
        payload.indexedThroughBlockHash ?? "",
      payloadSnapshotId: (payload) => payload.snapshotId ?? "",
      proofIndexLogHistoryPayload: async () => ({
        indexedThroughBlock: 105,
        items: [{}],
        latestEventBlock: 100,
        snapshotId: "snapshot-105",
        snapshotTotalCount: pageTotal,
        totalCount: pageTotal,
      }),
      proofIndexLogHistoryReadEligibility: () => ({
        pagination: { query: "", snapshotId: "" },
      }),
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload.indexedThroughBlock) || 0,
      summaryPayloadWithCanonicalProvenance: async () => ({
        consistency: { ok: true },
        indexedThroughBlock: 105,
        indexedThroughBlockHash: "a".repeat(64),
        provenance: { ready: true },
        snapshotId: "snapshot-105",
        stats: { total: 1 },
        totalCount: 1,
      }),
      verifiedFreshLogCheckpointAfterRead: async () => ({ exactTip: true }),
    },
  );
  const page = await freshPage("livenet", "", new URLSearchParams("limit=1"));
  assert.equal(page.indexedThroughBlock, 105);
  assert.equal(page.latestEventBlock, 100);
  assert.equal(page.provenance.surface, "log-history");

  pageTotal = 2;
  const error = await rejection(
    freshPage("livenet", "", new URLSearchParams("limit=1")),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_HISTORY_MISMATCH",
  );
  assert.equal(error.statusCode, 503);

  const canonicalFullItems = [
    {
      blockHash: "b".repeat(64),
      canonicalMinerFeeCovered: true,
      canonicalMinerFeeSats: 846,
      confirmed: true,
    },
    { confirmed: false },
  ];
  let fullItems = canonicalFullItems;
  let postReadCurrent = true;
  const freshFull = isolatedFunction(API_PATH, "freshProofIndexLogPayload", {
    activityStatsFromItems: (items, stats) => ({
      ...stats,
      pending: items.filter((item) => !item.confirmed).length,
      total: items.length,
    }),
    activitySummaryPayload: async () => ({ marker: "summary" }),
    freshDataUnavailableError: (message) => {
      const candidate = new Error(message);
      candidate.statusCode = 503;
      return candidate;
    },
    payloadIndexedThroughBlockHash: (payload) =>
      payload.indexedThroughBlockHash ?? "",
    payloadSnapshotId: (payload) => payload.snapshotId ?? "",
    proofIndexCanonicalActivityPayload: async () => ({
      activity: fullItems,
      canonicalMinerFeeCoverage: { complete: true },
      indexedThroughBlock: 105,
      latestEventBlock: 100,
      ledgerGeneratedAt: "2026-07-14T12:00:00.000Z",
      snapshotId: "snapshot-105",
      snapshotTotalCount: 2,
      source: "proof-indexer-events",
      totalCount: 2,
    }),
    proofIndexPayloadIndexedThroughBlock: (payload) =>
      Number(payload.indexedThroughBlock) || 0,
    summaryPayloadWithCanonicalProvenance: async () => ({
      consistency: { ok: true },
      indexedAt: "2026-07-14T12:00:00.000Z",
      indexedThroughBlock: 105,
      indexedThroughBlockHash: "a".repeat(64),
      ledgerGeneratedAt: "2026-07-14T12:00:00.000Z",
      provenance: { ready: true },
      snapshotId: "snapshot-105",
      stats: { latestEventBlock: 100, pending: 1, total: 2 },
      totalCount: 2,
    }),
    verifiedCanonicalMinerFeeCoverage: (value) =>
      value?.complete === true ? value : null,
    verifiedFreshLogCheckpointAfterRead: async () => {
      if (!postReadCurrent) {
        const candidate = new Error("Tip changed.");
        candidate.details = { code: "CANONICAL_LOG_TIP_CHANGED" };
        candidate.statusCode = 503;
        throw candidate;
      }
      return { exactTip: true };
    },
  });
  const fullPayload = await freshFull("livenet");
  assert.equal(fullPayload.activity.length, 2);
  assert.equal(fullPayload.indexedThroughBlock, 105);
  assert.equal(fullPayload.provenance.surface, "log");
  assert.equal(fullPayload.stats.pending, 1);
  assert.equal(fullPayload.activity[0].blockHash, "b".repeat(64));
  assert.equal(fullPayload.activity[0].canonicalMinerFeeSats, 846);
  assert.equal(fullPayload.activity[0].canonicalMinerFeeCovered, true);
  assert.equal(fullPayload.activity[1].blockHash, undefined);
  assert.equal(fullPayload.canonicalMinerFeeCoverage.complete, true);
  assert.equal(
    fullPayload.stats.canonicalMinerFeeCoverage.complete,
    true,
  );

  fullItems = [{ confirmed: true }, { confirmed: true }];
  const fullError = await rejection(
    freshFull("livenet"),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_MISMATCH",
  );
  assert.equal(fullError.statusCode, 503);

  fullItems = canonicalFullItems;
  postReadCurrent = false;
  const tipRaceError = await rejection(
    freshFull("livenet"),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_TIP_CHANGED",
  );
  assert.equal(tipRaceError.statusCode, 503);
});

check("fresh Log post-read checkpoint detects an exact-tip race", async () => {
  let exactTip = true;
  const checkpointHash = "a".repeat(64);
  const verifyAfterRead = isolatedFunction(
    API_PATH,
    "verifiedFreshLogCheckpointAfterRead",
    {
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      payloadIndexedThroughBlockHash: (payload) =>
        payload.indexedThroughBlockHash,
      payloadSnapshotId: (payload) => payload.snapshotId,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        payload.indexedThroughBlock,
      verifiedSummaryPayloadCheckpoint: async () => ({
        exactTip,
        indexedThroughBlock: 105,
        indexedThroughBlockHash: checkpointHash,
      }),
    },
  );
  const summary = {
    indexedThroughBlock: 105,
    indexedThroughBlockHash: checkpointHash,
    snapshotId: "snapshot-105",
  };
  assert.equal(
    (await verifyAfterRead(summary, "livenet", "log")).exactTip,
    true,
  );
  exactTip = false;
  const error = await rejection(
    verifyAfterRead(summary, "livenet", "log"),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_TIP_CHANGED",
  );
  assert.equal(error.statusCode, 503);
});

check("exact token tables own the current active listing set", () => {
  const key = (item) => `${item?.tokenId ?? ""}:${item?.listingId ?? ""}`;
  const tokenStateWithAuthoritativeCurrentListings = isolatedFunction(
    API_PATH,
    "tokenStateWithAuthoritativeCurrentListings",
    {
      mergeTokenListingRecord: (current, incoming) => ({
        ...(current ?? {}),
        ...(incoming ?? {}),
      }),
      mergeTokenStateItemsByKey: (currentItems, incomingItems, keyForItem, merge) => {
        const merged = new Map();
        for (const item of Array.isArray(currentItems) ? currentItems : []) {
          merged.set(keyForItem(item), item);
        }
        for (const item of Array.isArray(incomingItems) ? incomingItems : []) {
          const itemKey = keyForItem(item);
          merged.set(itemKey, merge(merged.get(itemKey), item));
        }
        return [...merged.values()];
      },
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      tokenClosedListingItemKey: key,
      tokenListingItemKey: key,
      tokenStateWithPendingStats: (state) => state,
    },
  );
  const current = tokenStateWithAuthoritativeCurrentListings(
    {
      closedListings: [],
      listings: [
        { listingId: "stale", tokenId: "work" },
        { listingId: "active", richField: true, tokenId: "work" },
        { listingId: "other", tokenId: "other" },
      ],
    },
    {
      closedListings: [
        { closedTxid: "close", listingId: "stale", tokenId: "work" },
      ],
      listings: [
        { listingId: "active", status: "active", tokenId: "work" },
      ],
      tokens: [{ tokenId: "work" }],
    },
  );
  assert.deepEqual(
    Array.from(current.listings, (listing) => listing.listingId).sort(),
    ["active", "other"],
  );
  assert.equal(
    current.listings.find((listing) => listing.listingId === "active")
      .richField,
    true,
  );
  assert.deepEqual(
    Array.from(current.closedListings, (listing) => listing.listingId),
    ["stale"],
  );
});

check("exact canonical source reads reject lagging activity and registry payloads", async () => {
  const activityPayload = {
    activity: [{ confirmed: true, txid: "a".repeat(64) }],
    canonicalMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 1,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 1,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
    indexedThroughBlock: 100,
  };
  const indexedActivityStateForCanonicalLedger = isolatedFunction(
    API_PATH,
    "indexedActivityStateForCanonicalLedger",
    {
      errorSummary: (error) => String(error?.message ?? error),
      proofIndexCanonicalActivityPayload: async () => activityPayload,
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock) || 0,
      proofIndexReadFeatureEnabled: () => true,
      verifiedCanonicalMinerFeeCoverage: isolatedFunction(
        API_PATH,
        "verifiedCanonicalMinerFeeCoverage",
      ),
    },
  );
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 101,
    }),
    null,
  );
  const exactActivity = await indexedActivityStateForCanonicalLedger(
    "livenet",
    {
      exactHeight: 100,
    },
  );
  assert.equal(exactActivity.indexedThroughBlock, 100);
  assert.equal(exactActivity.activity[0].txid, activityPayload.activity[0].txid);
  assert.equal(exactActivity.canonicalMinerFeeCoverage.complete, true);
  assert.equal(exactActivity.canonicalMinerFeeCoverage.confirmedEvents, 1);
  activityPayload.canonicalMinerFeeCoverage = {
    complete: false,
    missingConfirmedTransactions: 1,
  };
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 100,
    }),
    null,
  );
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 100,
      requireCanonicalMinerFeeCoverage: false,
    }),
    activityPayload,
    "nonfinancial Log reads may retain canonical activity visibility",
  );
  activityPayload.canonicalMinerFeeCoverage = {
    complete: true,
    confirmedEvents: 1,
    confirmedTransactions: 1,
    coveredConfirmedEvents: 1,
    coveredConfirmedTransactions: 1,
    missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0,
    missingConfirmedTxids: [],
    source: "proof-indexer-normalized-input-output-totals",
  };

  let livenetFallbackReads = 0;
  const activityStateForCanonicalLedger = isolatedFunction(
    API_PATH,
    "activityStateForCanonicalLedger",
    {
      ENABLE_GLOBAL_ACTIVITY_CRAWL: true,
      cachedGlobalActivityPayloadNoRefresh: async () => {
        livenetFallbackReads += 1;
        return { source: "cache" };
      },
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      globalActivityPayload: async () => {
        livenetFallbackReads += 1;
        return { source: "crawl" };
      },
      indexedActivityStateForCanonicalLedger: async () => null,
    },
  );
  await rejection(
    activityStateForCanonicalLedger("livenet", true),
    (error) => error?.statusCode === 503,
    "financial livenet ledgers must not fall back past fee coverage",
  );
  assert.equal(livenetFallbackReads, 0);

  const registryHash = "a".repeat(64);
  const registryPayload = {
    indexedThroughBlock: 100,
    indexedThroughBlockHash: registryHash,
    records: [{}],
  };
  const registryReadOptions = [];
  const indexedRegistryStateForCanonicalLedger = isolatedFunction(
    API_PATH,
    "indexedRegistryStateForCanonicalLedger",
    {
      indexedRegistryPayload: async (_network, options) => {
        registryReadOptions.push(options);
        return registryPayload;
      },
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock) || 0,
    },
  );
  assert.equal(
    await indexedRegistryStateForCanonicalLedger("livenet", {
      exactHash: registryHash,
      exactHeight: 101,
    }),
    null,
  );
  assert.equal(
    await indexedRegistryStateForCanonicalLedger("livenet", {
      exactHash: registryHash,
      exactHeight: 100,
    }),
    registryPayload,
  );
  assert.equal(
    await indexedRegistryStateForCanonicalLedger("livenet", {
      exactHeight: 100,
    }),
    null,
    "an exact registry height without its hash must fail closed",
  );
  assert.deepEqual(
    Array.from(registryReadOptions, (option) => ({
      exactHash: String(option?.exactHash ?? ""),
      exactHeight: Number(option?.exactHeight),
    })),
    [
      { exactHash: registryHash, exactHeight: 101 },
      { exactHash: registryHash, exactHeight: 100 },
    ],
  );
});

check("exact canonical registry reads accept age only at the requested checkpoint", async () => {
  const payload = {
    indexedAt: "2026-07-15T09:42:21.000Z",
    indexedThroughBlock: 958_137,
    indexedThroughBlockHash: "a".repeat(64),
    records: [{}],
  };
  let currentCoverageReads = 0;
  let rejectReason = `stale indexedAt ${payload.indexedAt}`;
  const readerOptions = [];
  const indexedRegistryPayload = isolatedFunction(
    API_PATH,
    "indexedRegistryPayload",
    {
      compareRegistryRecordDisplayOrder: () => 0,
      errorSummary: (error) => String(error?.message ?? error),
      proofIndexPayloadHasExplicitCurrentCoverage: async () => {
        currentCoverageReads += 1;
        return false;
      },
      proofIndexPayloadIndexedThroughBlock: (value) =>
        Number(value?.indexedThroughBlock) || 0,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexRegistryPayload: async (_network, options) => {
        readerOptions.push(options);
        return payload;
      },
      registryAddressForNetwork: () => "bc1registry",
      registryConfirmedCount: (value) => value?.records?.length ?? 0,
      registryIndexedPayloadRejectReason: () => rejectReason,
    },
  );

  assert.equal(await indexedRegistryPayload("livenet"), null);
  assert.equal(currentCoverageReads, 1);
  assert.equal(
    await indexedRegistryPayload("livenet", {
      exactHash: payload.indexedThroughBlockHash,
      exactHeight: 958_136,
    }),
    null,
  );
  assert.equal(currentCoverageReads, 2);
  assert.equal(
    await indexedRegistryPayload("livenet", {
      exactHash: payload.indexedThroughBlockHash,
      exactHeight: 958_138,
    }),
    null,
  );
  assert.equal(currentCoverageReads, 3);
  assert.equal(
    await indexedRegistryPayload("livenet", {
      exactHash: "b".repeat(64),
      exactHeight: 958_137,
    }),
    null,
  );
  assert.equal(currentCoverageReads, 4);
  const exactPayload = await indexedRegistryPayload("livenet", {
    exactHash: payload.indexedThroughBlockHash,
    exactHeight: 958_137,
  });
  assert.equal(
    Number(exactPayload?.indexedThroughBlock),
    payload.indexedThroughBlock,
  );
  assert.equal(
    String(exactPayload?.indexedThroughBlockHash),
    payload.indexedThroughBlockHash,
  );
  assert.equal(
    currentCoverageReads,
    4,
    "an exact checkpoint must not need current-tip coverage",
  );
  assert.deepEqual(
    Array.from(readerOptions, (option) => ({
      allowIncompleteScan: option?.allowIncompleteScan === true,
      expectedHash: String(option?.expectedHash ?? ""),
      expectedHeight: Number(option?.expectedHeight) || 0,
      registryAddress: String(option?.registryAddress ?? ""),
    })),
    [
      {
        allowIncompleteScan: false,
        expectedHash: "",
        expectedHeight: 0,
        registryAddress: "bc1registry",
      },
      ...Array.from({ length: 4 }, (_unused, index) => ({
        allowIncompleteScan: true,
        expectedHash:
          index === 3
            ? payload.indexedThroughBlockHash
            : index === 2
              ? "b".repeat(64)
              : payload.indexedThroughBlockHash,
        expectedHeight:
          index === 0
            ? 958_136
            : index === 1
              ? 958_138
              : 958_137,
        registryAddress: "bc1registry",
      })),
    ],
  );
  rejectReason = "duplicate ID records: duplicated-id";
  assert.equal(
    await indexedRegistryPayload("livenet", {
      exactHash: payload.indexedThroughBlockHash,
      exactHeight: 958_137,
    }),
    null,
    "exact checkpoint mode must retain duplicate-ID rejection",
  );
  rejectReason = `stale indexedAt ${payload.indexedAt}`;
  payload.records = [];
  assert.equal(
    await indexedRegistryPayload("livenet", {
      exactHash: payload.indexedThroughBlockHash,
      exactHeight: 958_137,
    }),
    null,
    "exact checkpoint mode must retain empty-livenet rejection",
  );
});

check("canonical registry state can replace a stale higher cached count", async () => {
  const payload = {
    indexedThroughBlock: 957_616,
    records: Array.from({ length: 492 }, () => ({})),
  };
  let rejectArguments = [];
  const indexedRegistryPayload = isolatedFunction(
    API_PATH,
    "indexedRegistryPayload",
    {
      compareRegistryRecordDisplayOrder: () => 0,
      errorSummary: (error) => String(error?.message ?? error),
      proofIndexReadFeatureEnabled: () => true,
      proofIndexRegistryPayload: async () => payload,
      proofIndexPayloadIndexedThroughBlock: (value) =>
        Number(value?.indexedThroughBlock) || 0,
      registryAddressForNetwork: () => "bc1registry",
      registryConfirmedCount: (value) => value?.records?.length ?? 0,
      registryIndexedPayloadRejectReason: (...args) => {
        rejectArguments = args;
        return "";
      },
    },
  );

  const accepted = await indexedRegistryPayload("livenet");
  assert.equal(accepted.indexedThroughBlock, payload.indexedThroughBlock);
  assert.equal(accepted.records.length, payload.records.length);
  assert.equal(rejectArguments.length, 1);
  assert.equal(
    rejectArguments[0].indexedThroughBlock,
    payload.indexedThroughBlock,
  );
  assert.equal(rejectArguments[0].records.length, payload.records.length);
});

check("indexed RUSH history is complete and ordered by canonical blocks", async () => {
  const firstTxid = "1".repeat(64);
  const secondTxid = "2".repeat(64);
  const canonicalRushHistoryEntries = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRushHistoryEntries",
    { isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)) },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        canonicalRushHistoryEntries(
          [
            { height: 100, tx_hash: secondTxid },
            { height: 0, tx_hash: "3".repeat(64) },
            { height: 102, tx_hash: "4".repeat(64) },
            { height: 100, tx_hash: firstTxid },
          ],
          101,
        ),
      ),
    ),
    [
      { height: 100, txid: firstTxid },
      { height: 100, txid: secondTxid },
    ],
  );
  assert.throws(
    () =>
      canonicalRushHistoryEntries(
        [
          { height: 100, tx_hash: firstTxid },
          { height: 101, tx_hash: firstTxid },
        ],
        101,
      ),
    /conflicting heights/u,
  );
  const rushStateFromIndexedMintEvents = isolatedFunction(
    API_PATH,
    "rushStateFromIndexedMintEvents",
    {
      freshDataUnavailableError: (message) => new Error(message),
      formatRushUnits: (units) => String(units),
      isValidBitcoinAddress: (address) => address.startsWith("bc1"),
      numericValue: (value) => Number(value ?? 0),
      RUSH_MINT_PRICE_SATS: 1_000,
      rushPhaseForOrdinal: (ordinal) => ({ phase: ordinal }),
      rushRewardUnitsForOrdinal: (ordinal) => BigInt(ordinal * 10),
      rushStatsFromMints: (mints) => ({ confirmedMints: mints.length }),
    },
  );
  const indexedItem = (txid, blockIndex) => ({
    blockHeight: 100,
    blockIndex,
    confirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    dataBytes: 11,
    kind: "rush-mint",
    minterAddress: `bc1minter${blockIndex}`,
    paidSats: 1_000,
    registryAddress: "bc1registry",
    txid,
    valid: true,
    validationMode: "canonical-ordered-rush-index",
  });
  const state = rushStateFromIndexedMintEvents(
    [indexedItem(firstTxid, 1), indexedItem(secondTxid, 0)],
    "bc1registry",
    "livenet",
    "2026-01-02T00:00:00.000Z",
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        state.mints.map((mint) => [mint.txid, mint.blockIndex, mint.ordinal]),
      ),
    ),
    [
      [firstTxid, 1, 2],
      [secondTxid, 0, 1],
    ],
  );
  assert.equal(state.stats.confirmedMints, 2);
  assert.throws(
    () =>
      rushStateFromIndexedMintEvents(
        [
          {
            ...indexedItem(firstTxid, 0),
            validationMode: "unproven",
          },
        ],
        "bc1registry",
        "livenet",
      ),
    /not canonical/u,
  );
});

check("partial RUSH reads require the explicit exact-checkpoint mode", async () => {
  const blockHash = "9".repeat(64);
  const bootstrapHash = "8".repeat(64);
  let queries = 0;
  const pool = {
    async query(sql) {
      queries += 1;
      if (String(sql).includes("SELECT value")) {
        return {
          rows: [
            {
              value: {
                indexedThroughBlock: 100,
                indexedThroughBlockHash: bootstrapHash,
                mintCount: 1,
                network: "livenet",
                version: 1,
              },
            },
          ],
        };
      }
      return {
        rows: [
          {
            block_height: 100,
            bootstrap_canonical: true,
            bootstrap_mint_count: 1,
            payload: { kind: "rush-mint", txid: "7".repeat(64) },
            protocol: "pwr1",
          },
        ],
      };
    },
  };
  const proofIndexRushPayload = isolatedFunction(
    READER_PATH,
    "proofIndexRushPayload",
    {
      eventRowPayload: (row) => row.payload,
      normalizedLowerText: (value) => String(value ?? "").toLowerCase(),
      objectRecord: (value) => value ?? {},
      proofIndexOperationalStatusPayload: async () => ({
        indexedAt: "2026-07-15T00:00:00.000Z",
        indexedThroughBlock: 101,
        scan: { blockHash, complete: false },
      }),
      proofIndexPool: () => pool,
    },
  );

  assert.equal(await proofIndexRushPayload("livenet", 101), null);
  assert.equal(queries, 0);
  assert.equal(
    await proofIndexRushPayload("livenet", 102, {
      allowIncompleteScan: true,
    }),
    null,
  );
  assert.equal(queries, 0);
  const accepted = await proofIndexRushPayload("livenet", 101, {
    allowIncompleteScan: true,
  });
  assert.equal(accepted.indexedThroughBlock, 101);
  assert.equal(accepted.indexedThroughBlockHash, blockHash);
  assert.equal(accepted.mints.length, 1);
  assert.equal(queries, 2);
});

check("internal canonical routes require token, loopback socket, and loopback Host", () => {
  const token = "t".repeat(64);
  const internalVerifierRequestAllowed = isolatedFunction(
    API_PATH,
    "internalVerifierRequestAllowed",
    { Buffer, INTERNAL_VERIFIER_TOKEN: token, timingSafeEqual },
  );
  const request = (presentedToken, remoteAddress, host = "127.0.0.1:8097") => ({
    headers: {
      host,
      "x-pow-internal-verifier": presentedToken,
    },
    socket: { remoteAddress },
  });
  assert.equal(
    internalVerifierRequestAllowed(request(token, "127.0.0.1")),
    true,
  );
  assert.equal(
    internalVerifierRequestAllowed(request(token, "::1", "[::1]:8097")),
    true,
  );
  assert.equal(
    internalVerifierRequestAllowed(request("wrong", "127.0.0.1")),
    false,
  );
  assert.equal(
    internalVerifierRequestAllowed(request(token, "203.0.113.8")),
    false,
  );
  assert.equal(
    internalVerifierRequestAllowed(
      request(token, "127.0.0.1", "computer.proofofwork.me"),
    ),
    false,
  );
});

check("an authenticated canonical summary can bind the current scan checkpoint behind Core", async () => {
  const checkpointHash = "a".repeat(64);
  const tipHash = "b".repeat(64);
  let faultActive = false;
  let canonicalCheckpointHash = checkpointHash;
  let rebuildActive = false;
  let rebuildCheckpointHash = checkpointHash;
  const exactCanonicalSummaryCheckpoint = isolatedFunction(
    API_PATH,
    "exactCanonicalSummaryCheckpoint",
    {
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockchaininfo") {
          return {
            ok: true,
            result: { bestblockhash: tipHash, blocks: 105 },
          };
        }
        if (method === "getblockhash" && params[0] === 101) {
          return { ok: true, result: canonicalCheckpointHash };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      proofIndexCanonicalStateMetaPayload: async () => ({
        fault: { active: faultActive },
        rebuild: {
          active: rebuildActive,
          complete: !rebuildActive,
          indexedThroughBlock: 101,
          indexedThroughBlockHash: rebuildCheckpointHash,
          network: "livenet",
          status: rebuildActive ? "active" : "complete",
        },
      }),
      proofIndexOperationalStatusPayload: async () => ({
        indexedThroughBlock: 101,
        readModels: {
          confirmedIds: { count: 1 },
          confirmedTransfers: { count: 1 },
        },
        scan: {
          blockHash: checkpointHash,
          complete: false,
          tipHeight: 105,
        },
      }),
    },
  );

  await rejection(
    exactCanonicalSummaryCheckpoint("livenet"),
    (error) => /Bitcoin Core tip/u.test(error.message),
    "The ordinary canonical summary route accepted a lagging scan checkpoint",
  );
  const accepted = await exactCanonicalSummaryCheckpoint("livenet", {
    checkpointHash,
    checkpointHeight: 101,
  });
  assert.equal(accepted.indexedThroughBlock, 101);
  assert.equal(accepted.tipHash, checkpointHash);

  rebuildActive = true;
  const acceptedDuringCatchup = await exactCanonicalSummaryCheckpoint(
    "livenet",
    { checkpointHash, checkpointHeight: 101 },
  );
  assert.equal(acceptedDuringCatchup.indexedThroughBlock, 101);
  assert.equal(acceptedDuringCatchup.tipHash, checkpointHash);
  rebuildCheckpointHash = "c".repeat(64);
  await rejection(
    exactCanonicalSummaryCheckpoint("livenet", {
      checkpointHash,
      checkpointHeight: 101,
    }),
    (error) => /hash-bound/u.test(error.message),
    "A mismatched active rebuild marker was allowed to publish a checkpoint",
  );
  rebuildCheckpointHash = checkpointHash;
  rebuildActive = false;

  canonicalCheckpointHash = "c".repeat(64);
  await rejection(
    exactCanonicalSummaryCheckpoint("livenet", {
      checkpointHash,
      checkpointHeight: 101,
    }),
    (error) => /hash-bound/u.test(error.message),
    "A reorged requested checkpoint was accepted",
  );
  canonicalCheckpointHash = checkpointHash;
  faultActive = true;
  await rejection(
    exactCanonicalSummaryCheckpoint("livenet", {
      checkpointHash,
      checkpointHeight: 101,
    }),
    (error) => /hash-bound/u.test(error.message),
    "An active canonical fault was allowed to publish a checkpoint",
  );
});

check("pending ID checks fall back to supported Electrum history", async () => {
  const calls = [];
  const electrumPendingScripthashEntries = isolatedFunction(
    API_PATH,
    "electrumPendingScripthashEntries",
    {
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      electrumRequest: async (method) => {
        calls.push(method);
        if (method === "blockchain.scripthash.get_mempool") {
          throw new Error("method not found");
        }
        return [
          { height: 956_000, tx_hash: "1".repeat(64) },
          { height: 0, tx_hash: "2".repeat(64) },
          { height: -1, tx_hash: "3".repeat(64) },
        ];
      },
      errorSummary: (error) => error.message,
    },
  );
  const entries = await electrumPendingScripthashEntries("fixture");
  assert.deepEqual(calls, [
    "blockchain.scripthash.get_mempool",
    "blockchain.scripthash.get_history",
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.height),
    [0, -1],
  );
});

const acceptCanonicalProtocolTransactionContent = () => {};
const canonicalVerificationFailureRecord = (error, { height, txid }) => ({
  error: error?.message ?? String(error),
  height,
  phase: "block-scan-verification",
  txid,
});

check("block verification completes before the atomic block transaction", async () => {
  const events = [];
  const txid = "4".repeat(64);
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      BLOCK_SCAN_MAX_BLOCKS: 0,
      BLOCK_SCAN_MAX_TXIDS: Number.POSITIVE_INFINITY,
      CANONICAL_REBUILD: false,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      canonicalRebuildCheckpointValue: () => null,
      proofIndexerMetaValue: async () => null,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 101;
        if (method === "getblockhash") return params[0] === 100 ? "h100" : "h101";
        if (method === "getblock") {
          return {
            hash: "h101",
            height: 101,
            nTx: 1,
            previousblockhash: "h100",
            time: 1_700_000_000,
            tx: [{ txid }],
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      latestBlockScanCheckpoint: async () => ({ blockHash: "h100", height: 100 }),
      assertCanonicalProtocolTransactionContent:
        acceptCanonicalProtocolTransactionContent,
      assertCanonicalBlockEnvelope: () => {},
      assertHydratedProtocolTransaction: () => {},
      canonicalBlockScanVerificationFailureRecord:
        canonicalVerificationFailureRecord,
      persistPreparedProtocolItems: async () => {
        events.push("persist");
        return { indexed: 1, skipped: 0 };
      },
      persistCanonicalBlock: async () => {
        events.push("block");
      },
      persistCanonicalRawTransaction: async () => {
        events.push("raw");
      },
      removeVolatileWorkMintDecisionEvents: async () => {
        events.push("cleanup");
      },
      preparedProtocolItemsForTx: async () => {
        events.push("verify");
        return [{ item: { txid }, sourceLabel: "id-records" }];
      },
      protocolMessagesFromTx: () => ["pwid1:r2:fixture"],
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {
        events.push("balances");
      },
      verifyCanonicalIncbPwtRangeReplayProjection: async () => null,
      storeBlockScanSnapshot: async () => {
        events.push("checkpoint");
      },
      transactionWithInputPrevouts: async (tx) => tx,
    },
  );
  const client = {
    async query(sql) {
      events.push(String(sql).trim());
      return { rows: [] };
    },
  };
  await backfillBlockScanSource(client, { label: "block-scan" });
  assert.deepEqual(events, [
    "verify",
    "BEGIN",
    "block",
    "raw",
    "cleanup",
    "persist",
    "balances",
    "checkpoint",
    "COMMIT",
  ]);
});

check("active range replay regenerates deleted exact H-1 checkpoints before verification", async () => {
  const hashes = {
    100: "1".repeat(64),
    101: "2".repeat(64),
    102: "3".repeat(64),
  };
  const txids = {
    101: "4".repeat(64),
    102: "5".repeat(64),
  };
  const completionCertificate = { verified: true };
  const completionVerifierInputs = [];
  const events = [];
  const regeneratedSnapshots = new Map();
  let rebuildState = {
    active: true,
    complete: false,
    indexedThroughBlock: 100,
    indexedThroughBlockHash: hashes[100],
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 101,
    status: "active",
  };
  const canonicalRebuildCheckpointValue = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRebuildCheckpointValue",
    {
      canonicalPwtRangeReplayState: (rebuild) =>
        rebuild?.mode === "pwt-range-replay" &&
        rebuild?.status === "active" &&
        rebuild?.active === true &&
        rebuild?.complete === false
          ? "active"
          : null,
    },
  );
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      BLOCK_SCAN_MAX_BLOCKS: 0,
      BLOCK_SCAN_MAX_TXIDS: Number.POSITIVE_INFINITY,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD: false,
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      STORE_CANONICAL_SUMMARY_SNAPSHOT: false,
      activePwtRangeReplay: (rebuild) =>
        rebuild?.mode === "pwt-range-replay" &&
        rebuild?.active === true &&
        rebuild?.status === "active",
      assertCanonicalProtocolTransactionContent:
        acceptCanonicalProtocolTransactionContent,
      assertCanonicalBlockEnvelope: () => {},
      assertHydratedProtocolTransaction: () => {},
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 102;
        if (method === "getblockhash") return hashes[params[0]];
        if (method === "getblock") {
          const height = Number(
            Object.entries(hashes).find(([, hash]) => hash === params[0])?.[0],
          );
          return {
            hash: hashes[height],
            height,
            nTx: 1,
            previousblockhash: hashes[height - 1],
            time: 1_700_000_000 + height,
            tx: [{ height, txid: txids[height] }],
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      canonicalRebuildCheckpointValue,
      canonicalBlockScanVerificationFailureRecord:
        canonicalVerificationFailureRecord,
      latestBlockScanCheckpoint: async () => ({
        blockHash: hashes[100],
        height: 100,
      }),
      persistCanonicalBlock: async (_client, _block, height) => {
        events.push(`block:${height}`);
      },
      persistCanonicalRawTransaction: async (client, tx) => {
        events.push(`raw:${tx.height}`);
      },
      persistPreparedProtocolItems: async (client, prepared) => {
        events.push(`persist:${prepared[0].item.blockHeight}`);
        return { indexed: 1, skipped: 0 };
      },
      preparedProtocolItemsForTx: async (tx) => {
        assert.equal(
          regeneratedSnapshots.get(tx.height - 1),
          hashes[tx.height - 1],
          "the exact H-1 row must exist before the verifier runs",
        );
        events.push(`verify:${tx.height}`);
        return [
          {
            item: {
              blockHeight: tx.height,
              confirmed: true,
              kind: "inception-bond",
              txid: tx.txid,
            },
          },
        ];
      },
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:rebuild" ? rebuildState : null,
      protocolMessagesContainInceptionBond: (messages) =>
        messages.some((message) => message.text === "pwm1:m:incb"),
      protocolMessagesFromTx: (tx) => [
        { prefix: "pwm1:", text: "pwm1:m:incb", voutIndex: 1, tx },
      ],
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {
        events.push(`balances:${rebuildState.indexedThroughBlock}`);
      },
      removeVolatileWorkMintDecisionEvents: async () => {},
      seedCanonicalBondDefinitions: async () => {},
      verifyCanonicalIncbPwtRangeReplayProjection: async (
        _client,
        completionSource,
      ) => {
        completionVerifierInputs.push(completionSource);
        assert.equal(completionSource.status, "active");
        assert.equal(completionSource.active, true);
        assert.equal(completionSource.complete, false);
        assert.equal(
          Object.hasOwn(completionSource, "incbRangeReplayVerification"),
          false,
          "the completion verifier must consume the active replay binding",
        );
        return completionCertificate;
      },
      storeBlockScanSnapshot: async (client, payload) => {
        events.push(`checkpoint:${payload.indexedThroughBlock}`);
      },
      storeCanonicalSummarySnapshot: async (client, options) => {
        const checkpoint = options.requiredCheckpoint;
        assert.equal(rebuildState.indexedThroughBlock, checkpoint.height);
        assert.equal(
          rebuildState.indexedThroughBlockHash,
          checkpoint.blockHash,
        );
        events.push(`summary:${checkpoint.height}`);
        regeneratedSnapshots.set(checkpoint.height, checkpoint.blockHash);
        return {
          indexedThroughBlock: checkpoint.height,
          indexedThroughBlockHash: checkpoint.blockHash,
        };
      },
      storeProofIndexerMeta: async (_client, key, value) => {
        assert.equal(key, "canonical:rebuild");
        rebuildState = value;
      },
      transactionWithInputPrevouts: async (tx) => tx,
    },
  );
  const client = {
    async query(sql) {
      const statement = String(sql).trim();
      if (statement === "COMMIT" || statement === "ROLLBACK") {
        events.push(statement.toLowerCase());
      }
      return { rows: [] };
    },
  };

  const result = await backfillBlockScanSource(client, {
    label: "block-scan",
  });
  assert.equal(result.indexedThroughBlock, 102);
  assert.equal(result.complete, true);
  assert.ok(events.indexOf("balances:100") < events.indexOf("summary:100"));
  assert.ok(events.indexOf("summary:100") < events.indexOf("verify:101"));
  assert.ok(events.indexOf("commit") < events.indexOf("summary:101"));
  assert.ok(events.indexOf("balances:101") < events.indexOf("summary:101"));
  assert.ok(events.indexOf("summary:101") < events.indexOf("verify:102"));
  assert.equal(events.filter((event) => event === "summary:100").length, 1);
  assert.equal(events.filter((event) => event === "summary:101").length, 1);
  assert.equal(completionVerifierInputs.length, 1);
  assert.equal(completionVerifierInputs[0].indexedThroughBlock, 101);
  assert.equal(rebuildState.status, "complete");
  assert.equal(rebuildState.active, false);
  assert.equal(rebuildState.complete, true);
  assert.deepEqual(
    rebuildState.incbRangeReplayVerification,
    completionCertificate,
  );
  assert.deepEqual(
    [...regeneratedSnapshots.entries()],
    [
      [100, hashes[100]],
      [101, hashes[101]],
    ],
    "range replay must republish the H-1 rows deleted during preparation",
  );
});

check("already-at-tip range replay certifies from its active metadata", async () => {
  const checkpointHash = "1".repeat(64);
  const completionCertificate = { verified: true };
  const activeRebuild = {
    active: true,
    complete: false,
    indexedThroughBlock: 100,
    indexedThroughBlockHash: checkpointHash,
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 100,
    status: "active",
  };
  const replayState = (rebuild) =>
    rebuild?.mode === "pwt-range-replay" &&
    rebuild?.status === "active" &&
    rebuild?.active === true &&
    rebuild?.complete === false
      ? "active"
      : rebuild?.mode === "pwt-range-replay" &&
          rebuild?.status === "complete" &&
          rebuild?.active === false &&
          rebuild?.complete === true &&
          rebuild?.incbRangeReplayVerification
        ? "complete"
        : "invalid";
  const canonicalRebuildCheckpointValue = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRebuildCheckpointValue",
    { canonicalPwtRangeReplayState: replayState },
  );
  const storedMeta = [];
  const snapshots = [];
  const verifierInputs = [];
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD: false,
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      assertCanonicalPwtRangeReplayState: replayState,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 100;
        if (method === "getblockhash" && Number(params[0]) === 100) {
          return checkpointHash;
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      canonicalRebuildCheckpointValue,
      latestBlockScanCheckpoint: async () => ({
        blockHash: checkpointHash,
        height: 100,
      }),
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:rebuild" ? activeRebuild : null,
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {},
      seedCanonicalBondDefinitions: async () => {},
      storeBlockScanSnapshot: async (_client, payload) => {
        snapshots.push(payload);
      },
      storeProofIndexerMeta: async (_client, key, value) => {
        assert.equal(key, "canonical:rebuild");
        storedMeta.push(value);
      },
      verifyCanonicalIncbPwtRangeReplayProjection: async (
        _client,
        completionSource,
      ) => {
        verifierInputs.push(completionSource);
        assert.equal(completionSource.status, "active");
        assert.equal(completionSource.active, true);
        assert.equal(completionSource.complete, false);
        assert.equal(
          Object.hasOwn(completionSource, "incbRangeReplayVerification"),
          false,
        );
        return completionCertificate;
      },
    },
  );
  const statements = [];
  const result = await backfillBlockScanSource(
    {
      async query(sql) {
        statements.push(String(sql).trim());
        return { rows: [] };
      },
    },
    { label: "block-scan" },
  );

  assert.equal(result.latestIndexedHeight, 100);
  assert.equal(result.blocks, 0);
  assert.equal(verifierInputs.length, 1);
  assert.equal(verifierInputs[0], activeRebuild);
  assert.equal(storedMeta.length, 1);
  assert.equal(replayState(storedMeta[0]), "complete");
  assert.deepEqual(
    storedMeta[0].incbRangeReplayVerification,
    completionCertificate,
  );
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].rebuild, storedMeta[0]);
  assert.deepEqual(statements, ["BEGIN", "COMMIT"]);
});

check("bound range replay accepts only exact pre-range INCB mint witnesses", async () => {
  const INCEPTION_ISSUANCE_ACCOUNTING_MODEL =
    "canonical-pre-bond-live-network-value-v2";
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL =
    "proof-indexer-pwt-range-replay-verifier-binding-v1";
  const rangeReplayFromHeight = 958_383;
  const replayVerifierBinding = replayVerifierBindingFixture({
    bindingId: "9".repeat(64),
    createdAt: "2026-07-18T20:00:00.000Z",
    rangeReplayFromHeight,
    witnessedThroughBlock: rangeReplayFromHeight - 1,
    witnessedThroughBlockHash: "5".repeat(64),
  });
  const txid =
    "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21";
  const blockHash = "8".repeat(64);
  const previousBlockHash =
    "00000000000000000000a9c98064bcf92b25b7c43576c8479befdcb17dfb85cd";
  const blockHeight = 958_007;
  const blockIndex = 2_014;
  const recipientAddress = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
  const snapshotWorkNetworkValueSats = "8193547095.322113";
  const attachedWorkLiveValueAtSendSats = "1421798915.6275952";
  const attachedWorkAmount = "3644060";
  const confirmedIssuanceUnits = "1421799461";
  const samePaymentAddress = (left, right) =>
    String(left ?? "").trim().toLowerCase() ===
    String(right ?? "").trim().toLowerCase();
  const numbersAgree = (left, right, tolerance = 0) =>
    Math.abs(Number(left) - Number(right)) <= tolerance;
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const bondRecipientMintsFromActivityItem = isolatedFunction(
    API_PATH,
    "bondRecipientMintsFromActivityItem",
    {
      activityAmountSats: (item) => numericValue(item?.amountSats),
      canonicalEventOrdinal,
      isBondActivityItem: (item, config) => item?.kind === config?.kind,
      isValidBitcoinAddress: (address) => Boolean(String(address ?? "").trim()),
    },
  );
  const inceptionIssuanceMetadataFromMints = isolatedFunction(
    API_PATH,
    "inceptionIssuanceMetadataFromMints",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      WORK_TOKEN_MAX_SUPPLY,
      numbersAgree,
      samePaymentAddress,
    },
  );
  const inceptionMintHasCanonicalBondBinding = isolatedFunction(
    API_PATH,
    "inceptionMintHasCanonicalBondBinding",
    {
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      canonicalEventOrdinal,
      inceptionIssuanceMetadataFromMints,
      samePaymentAddress,
    },
  );
  const canonicalStoredInceptionWitnessSet = isolatedFunction(
    API_PATH,
    "canonicalStoredInceptionWitnessSet",
    {
      INCB_TOKEN_ID,
      INCEPTION_BOND_CONFIG: { kind: "inception-bond" },
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      bondRecipientMintsFromActivityItem,
      canonicalEventOrdinal,
      inceptionIssuanceMetadataFromMints,
      inceptionMintHasCanonicalBondBinding,
      samePaymentAddress,
    },
  );
  const canonicalPwtReplayVerifierBindingDescriptor = isolatedFunction(
    API_PATH,
    "canonicalPwtReplayVerifierBindingDescriptor",
    {
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: rangeReplayFromHeight,
      PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
    },
  );
  const canonicalPwtReplayVerifierBindingCacheKey = isolatedFunction(
    API_PATH,
    "canonicalPwtReplayVerifierBindingCacheKey",
    { canonicalPwtReplayVerifierBindingDescriptor },
  );
  const bond = {
    attachedCredits: [
      {
        amount: attachedWorkAmount,
        protocolVout: 4,
        recipientAddress,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    kind: "inception-bond",
    network: "livenet",
    recipients: [
      { address: recipientAddress, amountSats: 546, vout: 0 },
    ],
    txid,
  };
  const witness = {
    amount: confirmedIssuanceUnits,
    amountSats: 0,
    attachedWorkAmount,
    attachedWorkIssuanceUnits: "1421798915",
    attachedWorkLiveFloorAtSendSats:
      Number(snapshotWorkNetworkValueSats) / WORK_TOKEN_MAX_SUPPLY,
    attachedWorkLiveValueAtSendSats,
    bondRecipientAddress: recipientAddress,
    bondRecipientAmountSats: 546,
    bondRecipientVout: 0,
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    confirmedIssuanceUnits,
    directProofIssuanceUnits: "546",
    issuanceAccountingModel: INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
    issuanceAmount: confirmedIssuanceUnits,
    issuanceCheckpointBlockHash: blockHash,
    issuanceCheckpointBlockHeight: blockHeight,
    issuanceCheckpointBlockIndex: blockIndex,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustSats: "0.6275952",
    issuanceFloorSats:
      Number("1421799461.6275952") / Number(confirmedIssuanceUnits),
    issuanceNetworkValueSats: "1421799461.6275952",
    issuanceUnitSats: 1,
    issuanceValuationFixedAtSend: true,
    issuanceValueSnapshotBlockHash: previousBlockHash,
    issuanceValueSnapshotBlockHeight: blockHeight - 1,
    issuanceValueSnapshotCanonicalSummaryHash: "7".repeat(64),
    issuanceValueSnapshotGeneratedAt: "2026-07-13T03:13:00.000Z",
    issuanceValueSnapshotId: "d8-pre-range-h-minus-one",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
    issuanceValueSnapshotWorkNetworkValueSats:
      snapshotWorkNetworkValueSats,
    minterAddress: recipientAddress,
    network: "livenet",
    paidSats: 546,
    proofPaymentSats: 546,
    sourceBondTxid: txid,
    sourceKind: "inception-bond",
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
    txid,
    validationMode: "canonical-incb-bond-projection",
  };
  assert.equal(
    inceptionIssuanceMetadataFromMints([witness]).complete,
    true,
    "the d8-style legacy decimal witness must derive exact Q8 issuance",
  );
  assert.equal(
    inceptionIssuanceMetadataFromMints([witness])
      .attachedWorkLiveValueAtSendQ8,
    "142179891562759519",
  );
  assert.equal(
    inceptionIssuanceMetadataFromMints([
      {
        ...witness,
        issuanceValueSnapshotWorkNetworkValueSats: Number(
          snapshotWorkNetworkValueSats,
        ),
      },
    ]).complete,
    false,
    "legacy issuance metadata must never promote a JSON Number into exact Q8",
  );

  const previousHashes = new Map([[blockHash, previousBlockHash]]);
  let historicalSummaryReads = 0;
  const cacheKeys = [];
  const canonicalInceptionIssuanceOptions = isolatedFunction(
    API_PATH,
    "canonicalInceptionIssuanceOptions",
    {
      canonicalInceptionPreviousBlockHash: async (_network, candidate) =>
        previousHashes.get(String(candidate?.blockHash ?? "")) ?? "",
      canonicalInceptionValueSnapshotCheckpoint: () => null,
      canonicalPwtReplayVerifierBindingCacheKey,
      canonicalPwtReplayVerifierBindingDescriptor,
      canonicalStoredInceptionWitnessSet,
      canonicalEventOrdinal,
      cachedInternalVerifierState: async (key, loader) => {
        cacheKeys.push(key);
        return loader();
      },
      inceptionValueSnapshotUnavailableError: (_bond, details = {}) =>
        Object.assign(new Error(details.reason ?? "snapshot unavailable"), {
          details,
        }),
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      proofIndexCanonicalSummaryLedgerPayload: async () => {
        historicalSummaryReads += 1;
        throw new Error("historical summary must not be read");
      },
      samePaymentAddress,
    },
  );
  const issuanceOptions = await canonicalInceptionIssuanceOptions(
    "livenet",
    [bond],
    {
      preRangeMintWitnesses: [witness],
      previousBlockHashByBlockHash: previousHashes,
      replayVerifierBinding,
    },
  );
  assert.equal(historicalSummaryReads, 0);
  assert.equal(cacheKeys.length, 0);
  assert.equal(
    issuanceOptions.preBondCheckpoint(bond).workNetworkValueQ8,
    "819354709532211300",
  );
  assert.equal(issuanceOptions.preRangeStoredMint(witness, bond), witness);

  const ledgerTokenStateForScope = (ledger, tokenId) =>
    tokenId === WORK_TOKEN_ID ? ledger.workTokenState : ledger.tokenState;
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID,
      canonicalEventOrdinal,
      ledgerTokenStateForScope,
      samePaymentAddress,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      WORK_TOKEN_MAX_SUPPLY,
      inceptionAttachmentMatchesForBond,
      inceptionMintHasCanonicalBondBinding,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      samePaymentAddress,
    },
  );
  const ledger = {
    network: "livenet",
    tokenState: { mints: [witness] },
    workTokenState: {
      transfers: [
        {
          amount: attachedWorkAmount,
          blockHash,
          blockHeight,
          blockIndex,
          confirmed: true,
          protocolVout: 4,
          recipientAddress,
          tokenId: WORK_TOKEN_ID,
          txid,
          valid: true,
        },
      ],
    },
  };
  const [accepted] = inceptionMintsWithLiveIssuance(
    [witness],
    [bond],
    ledger,
    issuanceOptions,
  );
  assert.equal(accepted, witness);
  assert.equal(inceptionIssuanceMetadataFromMints([accepted]).complete, true);

  const malformedWitnesses = [
    ["missing", []],
    ["duplicate", [witness, { ...witness }]],
    [
      "previous-block hash",
      [{ ...witness, issuanceValueSnapshotBlockHash: "6".repeat(64) }],
    ],
    [
      "recipient",
      [
        {
          ...witness,
          bondRecipientAddress: "bc1wrongrecipient",
          minterAddress: "bc1wrongrecipient",
        },
      ],
    ],
    [
      "amount",
      [{ ...witness, amount: String(BigInt(witness.amount) + 1n) }],
    ],
    [
      "Q8",
      [
        {
          ...witness,
          issuanceValueSnapshotWorkNetworkValueQ8:
            "819354709532211300",
        },
      ],
    ],
    [
      "numeric legacy snapshot",
      [
        {
          ...witness,
          issuanceValueSnapshotWorkNetworkValueSats: Number(
            snapshotWorkNetworkValueSats,
          ),
        },
      ],
    ],
    ["provenance", [{ ...witness, issuanceValueSnapshotId: "" }]],
  ];
  for (const [label, preRangeMintWitnesses] of malformedWitnesses) {
    await rejection(
      canonicalInceptionIssuanceOptions("livenet", [bond], {
        preRangeMintWitnesses,
        previousBlockHashByBlockHash: previousHashes,
        replayVerifierBinding,
      }),
      (error) =>
        error?.details?.reason === "stored-pre-range-witness-invalid",
      `${label} pre-range witness did not fail closed`,
    );
  }
  assert.equal(
    historicalSummaryReads,
    0,
    "invalid pre-range witnesses must not fall through to an unbound historical summary",
  );

  const attachmentMismatchLedger = {
    ...ledger,
    workTokenState: {
      transfers: [
        {
          ...ledger.workTokenState.transfers[0],
          amount: "3644059",
        },
      ],
    },
  };
  const [attachmentMismatch] = inceptionMintsWithLiveIssuance(
    [witness],
    [bond],
    attachmentMismatchLedger,
    issuanceOptions,
  );
  assert.equal(
    attachmentMismatch.validationMode,
    "canonical-incb-pre-range-witness-mismatch",
  );
  assert.equal(
    inceptionIssuanceMetadataFromMints([attachmentMismatch]).complete,
    false,
    "a stored witness cannot override the replayed WORK attachment",
  );
  const checkpointComparisonMints = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      inceptionMintHasCanonicalBondBinding: () => true,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      samePaymentAddress,
    },
  );
  const [numericLegacyCheckpointMismatch] = checkpointComparisonMints(
    [
      {
        ...witness,
        issuanceValueSnapshotWorkNetworkValueSats: Number(
          snapshotWorkNetworkValueSats,
        ),
      },
    ],
    [bond],
    { network: "livenet" },
    {
      preBondCheckpoint: () => issuanceOptions.preBondCheckpoint(bond),
    },
  );
  assert.equal(
    numericLegacyCheckpointMismatch.validationMode,
    "canonical-incb-value-snapshot-mismatch",
    "published H-1 comparison must not promote a numeric legacy alias",
  );
});

check("bound post-cutoff INCB witnesses preserve exact Q8 or rederive live H-1", async () => {
  const INCEPTION_ISSUANCE_ACCOUNTING_MODEL =
    "canonical-pre-bond-live-network-value-v2";
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const rangeReplayFromHeight = 958_383;
  const preserveBlockHeight = 958_400;
  const rederiveBlockHeight = preserveBlockHeight + 1;
  const postCaptureBlockHeight = rederiveBlockHeight + 1;
  const preserveTxid = "1".repeat(64);
  const rederiveTxid = "2".repeat(64);
  const postCaptureTxid = "3".repeat(64);
  const preserveBlockHash = "4".repeat(64);
  const preservePreviousBlockHash = "5".repeat(64);
  const rederiveBlockHash = "6".repeat(64);
  const postCaptureBlockHash = "7".repeat(64);
  const address = "bc1qboundincbwitnessrecipient000000000000000000000";
  const attachedWorkAmountAtoms = "100000000";
  const snapshotWorkNetworkValueQ8 = 3_975_162_634_405_565_123_456_789n;
  const attachedWorkValueQ8 =
    snapshotWorkNetworkValueQ8 / BigInt(WORK_TOKEN_MAX_SUPPLY);
  const directValueQ8 = 546n * BOND_VALUE_Q8_SCALE;
  const issuanceNetworkValueQ8 = directValueQ8 + attachedWorkValueQ8;
  const confirmedIssuanceUnits =
    issuanceNetworkValueQ8 / BOND_VALUE_Q8_SCALE;
  const attachedWorkIssuanceUnits =
    attachedWorkValueQ8 / BOND_VALUE_Q8_SCALE;
  const issuanceDustQ8 = issuanceNetworkValueQ8 % BOND_VALUE_Q8_SCALE;
  const snapshotId = "bound-post-cutoff-v2-h-minus-one";
  const snapshotGeneratedAt = "2026-07-18T20:00:00.000Z";
  const summaryHash = "8".repeat(64);
  const roundedLegacySnapshotAlias = Number(
    q8ToCanonicalDecimal(snapshotWorkNetworkValueQ8),
  );

  const samePaymentAddress = (left, right) =>
    String(left ?? "").trim().toLowerCase() ===
    String(right ?? "").trim().toLowerCase();
  const numbersAgree = (left, right, tolerance = 0) =>
    Math.abs(Number(left) - Number(right)) <= tolerance;
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const bondRecipientMintsFromActivityItem = isolatedFunction(
    API_PATH,
    "bondRecipientMintsFromActivityItem",
    {
      activityAmountSats: (item) => numericValue(item?.amountSats),
      canonicalEventOrdinal,
      isBondActivityItem: (item, config) => item?.kind === config?.kind,
      isValidBitcoinAddress: (candidate) =>
        Boolean(String(candidate ?? "").trim()),
    },
  );
  const inceptionIssuanceMetadataFromMints = isolatedFunction(
    API_PATH,
    "inceptionIssuanceMetadataFromMints",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      WORK_TOKEN_MAX_SUPPLY,
      numbersAgree,
      samePaymentAddress,
    },
  );
  const inceptionMintHasCanonicalBondBinding = isolatedFunction(
    API_PATH,
    "inceptionMintHasCanonicalBondBinding",
    {
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      canonicalEventOrdinal,
      inceptionIssuanceMetadataFromMints,
      samePaymentAddress,
    },
  );
  const inceptionBondDeclaredWorkAtomsForRecipient = isolatedFunction(
    API_PATH,
    "inceptionBondDeclaredWorkAtomsForRecipient",
    { WORK_TOKEN_ID, samePaymentAddress, workAtomsBigIntFromRecord },
  );
  const canonicalBoundInceptionWitnessDisposition = isolatedFunction(
    API_PATH,
    "canonicalBoundInceptionWitnessDisposition",
  );
  const canonicalInceptionBondRecipientOutputs = isolatedFunction(
    API_PATH,
    "canonicalInceptionBondRecipientOutputs",
    { canonicalEventOrdinal, samePaymentAddress },
  );
  const canonicalBoundInceptionWitnessSet = isolatedFunction(
    API_PATH,
    "canonicalBoundInceptionWitnessSet",
    {
      INCB_TOKEN_ID,
      INCEPTION_BOND_CONFIG: { kind: "inception-bond" },
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      bondRecipientMintsFromActivityItem,
      canonicalEventOrdinal,
      canonicalInceptionBondRecipientOutputs,
      inceptionBondDeclaredWorkAtomsForRecipient,
      inceptionIssuanceMetadataFromMints,
      inceptionMintHasCanonicalBondBinding,
      samePaymentAddress,
    },
  );

  const makeBond = ({ blockHash, blockHeight, txid }) => ({
    attachedCredits: [
      {
        amount: "1",
        amountAtoms: attachedWorkAmountAtoms,
        decimals: WORK_DECIMALS,
        protocolVout: 4,
        recipientAddress: address,
        tokenId: WORK_TOKEN_ID,
        unitScale: WORK_UNIT_SCALE_TEXT,
      },
    ],
    blockHash,
    blockHeight,
    blockIndex: 12,
    confirmed: true,
    kind: "inception-bond",
    network: "livenet",
    recipients: [{ address, amountSats: 546, vout: 0 }],
    txid,
  });
  const preserveBond = makeBond({
    blockHash: preserveBlockHash,
    blockHeight: preserveBlockHeight,
    txid: preserveTxid,
  });
  const rederiveBond = makeBond({
    blockHash: rederiveBlockHash,
    blockHeight: rederiveBlockHeight,
    txid: rederiveTxid,
  });
  const postCaptureBond = makeBond({
    blockHash: postCaptureBlockHash,
    blockHeight: postCaptureBlockHeight,
    txid: postCaptureTxid,
  });
  const mint = {
    amount: confirmedIssuanceUnits.toString(),
    amountSats: 0,
    attachedWorkAmount: "1",
    attachedWorkAmountAtoms,
    attachedWorkIssuanceUnits: attachedWorkIssuanceUnits.toString(),
    attachedWorkLiveFloorAtSendQ8: attachedWorkValueQ8.toString(),
    attachedWorkLiveFloorAtSendSats:
      q8ToCanonicalDecimal(attachedWorkValueQ8),
    attachedWorkLiveValueAtSendQ8: attachedWorkValueQ8.toString(),
    attachedWorkLiveValueAtSendSats:
      q8ToCanonicalDecimal(attachedWorkValueQ8),
    blockHash: preserveBlockHash,
    blockHeight: preserveBlockHeight,
    blockIndex: preserveBond.blockIndex,
    bondRecipientAddress: address,
    bondRecipientAmountSats: 546,
    bondRecipientVout: 0,
    confirmed: true,
    confirmedIssuanceUnits: confirmedIssuanceUnits.toString(),
    directProofIssuanceUnits: "546",
    issuanceAccountingModel: INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
    issuanceAmount: confirmedIssuanceUnits.toString(),
    issuanceCheckpointBlockHash: preserveBlockHash,
    issuanceCheckpointBlockHeight: preserveBlockHeight,
    issuanceCheckpointBlockIndex: preserveBond.blockIndex,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustQ8: issuanceDustQ8.toString(),
    issuanceDustSats: q8ToCanonicalDecimal(issuanceDustQ8),
    issuanceFloorSats: q8ToCanonicalDecimal(
      issuanceNetworkValueQ8 / confirmedIssuanceUnits,
    ),
    issuanceNetworkValueQ8: issuanceNetworkValueQ8.toString(),
    issuanceNetworkValueSats:
      q8ToCanonicalDecimal(issuanceNetworkValueQ8),
    issuanceUnitSats: 1,
    issuanceValuationFixedAtSend: true,
    issuanceValueSnapshotBlockHash: preservePreviousBlockHash,
    issuanceValueSnapshotBlockHeight: preserveBlockHeight - 1,
    issuanceValueSnapshotCanonicalSummaryHash: summaryHash,
    issuanceValueSnapshotGeneratedAt: snapshotGeneratedAt,
    issuanceValueSnapshotId: snapshotId,
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
    issuanceValueSnapshotWorkNetworkValueQ8:
      snapshotWorkNetworkValueQ8.toString(),
    issuanceValueSnapshotWorkNetworkValueSats:
      roundedLegacySnapshotAlias,
    minterAddress: address,
    network: "livenet",
    paidSats: 546,
    proofPaymentSats: 546,
    sourceBondTxid: preserveTxid,
    sourceKind: "inception-bond",
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
    txid: preserveTxid,
    validationMode: "canonical-incb-bond-projection",
  };
  assert.equal(typeof mint.issuanceValueSnapshotWorkNetworkValueSats, "number");
  assert.equal(
    inceptionIssuanceMetadataFromMints([mint]).complete,
    true,
    "exact v2 Q8 must remain authoritative over the rounded JSON Number alias",
  );

  const snapshot = {
    canonicalSummaryHash: summaryHash,
    consistencyOk: true,
    consistencyStatus: "green",
    generatedAt: snapshotGeneratedAt,
    indexedThroughBlock: preserveBlockHeight - 1,
    payloadBlockHash: preservePreviousBlockHash,
    payloadSnapshotId: snapshotId,
    rawSnapshotFingerprint: "9".repeat(64),
    snapshotId,
    sourceBlockHash: preservePreviousBlockHash,
    summaryRefreshBlockHash: preservePreviousBlockHash,
    summaryRefreshMode: "canonical-summary-refresh",
    workFloorBlockHash: preservePreviousBlockHash,
    workFloorHeight: preserveBlockHeight - 1,
    workFloorSnapshotId: snapshotId,
    workNetworkValueMode:
      "exact-mint-q8-bound-to-legacy-green-snapshot-v1",
    workNetworkValueQ8: snapshotWorkNetworkValueQ8.toString(),
  };
  const preserveEntry = {
    bond: {
      attachedWorkAmountAtoms,
      blockHash: preserveBlockHash,
      blockHeight: preserveBlockHeight,
      blockIndex: preserveBond.blockIndex,
      bondRecipientAddress: address,
      bondRecipientAmountSats: "546",
      bondRecipientOutputs: [{ amountSats: "546", vout: 0 }],
      bondRecipientVout: 0,
      previousBlockHash: preservePreviousBlockHash,
      txid: preserveTxid,
    },
    disposition: "preserve",
    mintPayload: mint,
    mintPayloadHash: canonicalIncbReplaySha256(mint),
    reason: "exact v2 mint bound to its immutable legacy green snapshot",
    snapshot,
    snapshotFingerprint: incbReplaySnapshotFingerprint(snapshot),
  };
  const rederiveEntry = {
    bond: {
      attachedWorkAmountAtoms,
      blockHash: rederiveBlockHash,
      blockHeight: rederiveBlockHeight,
      blockIndex: rederiveBond.blockIndex,
      bondRecipientAddress: address,
      bondRecipientAmountSats: "546",
      bondRecipientOutputs: [{ amountSats: "546", vout: 0 }],
      bondRecipientVout: 0,
      previousBlockHash: preserveBlockHash,
      txid: rederiveTxid,
    },
    disposition: "rederive",
    reason: "no immutable accepted v2 mint exists",
  };
  const replayBinding = replayVerifierBindingFixture({
    bindingId: "a".repeat(64),
    createdAt: "2026-07-18T20:01:00.000Z",
    witnessCount: 2,
    witnessPreserveCount: 1,
    witnessSetHash: "b".repeat(64),
    witnessedThroughBlock: rederiveBlockHeight,
    witnessedThroughBlockHash: rederiveBlockHash,
  });
  const preserveDisposition =
    canonicalBoundInceptionWitnessDisposition(preserveEntry, replayBinding);
  const rederiveDisposition =
    canonicalBoundInceptionWitnessDisposition(rederiveEntry, replayBinding);
  assert.ok(preserveDisposition);
  assert.ok(rederiveDisposition);
  assert.strictEqual(preserveDisposition.mintPayload, mint);
  const groupedRecipientBond = {
    ...preserveBond,
    recipients: [
      { address, amountSats: 500, vout: 0 },
      { address, amountSats: 46, vout: 2 },
    ],
  };
  const groupedPreserveDisposition =
    canonicalBoundInceptionWitnessDisposition(
      {
        ...preserveEntry,
        bond: {
          ...preserveEntry.bond,
          bondRecipientOutputs: [
            { amountSats: "500", vout: 0 },
            { amountSats: "46", vout: 2 },
          ],
        },
      },
      replayBinding,
    );
  assert.ok(
    canonicalBoundInceptionWitnessSet(
      groupedRecipientBond,
      [groupedPreserveDisposition],
      preservePreviousBlockHash,
    ),
    "a bound witness must preserve every grouped same-address output",
  );
  assert.equal(
    canonicalBoundInceptionWitnessSet(
      groupedRecipientBond,
      [preserveDisposition],
      preservePreviousBlockHash,
    ),
    null,
    "a first-vout/total match cannot hide a missing recipient output",
  );

  const canonicalBoundInceptionWitnessEnvelope = isolatedFunction(
    API_PATH,
    "canonicalBoundInceptionWitnessEnvelope",
    {
      canonicalBoundInceptionWitnessDisposition,
      canonicalEventOrdinal,
      samePaymentAddress,
    },
  );
  const envelopePayload = {
    checkpointHash: "c".repeat(64),
    dispositions: [preserveEntry, rederiveEntry],
    fault: null,
    indexedThroughBlock: 958_450,
    mints: [mint],
    network: "livenet",
    rangeReplayFromHeight,
    source: INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
    witnessCount: replayBinding.witnessCount,
    witnessPreserveCount: replayBinding.witnessPreserveCount,
    witnessedThroughBlock: replayBinding.witnessedThroughBlock,
    witnessedThroughBlockHash: replayBinding.witnessedThroughBlockHash,
    witnessSetHash: replayBinding.witnessSetHash,
  };
  const envelope = canonicalBoundInceptionWitnessEnvelope(
    envelopePayload,
    replayBinding,
    "livenet",
    envelopePayload.indexedThroughBlock,
    envelopePayload.checkpointHash,
  );
  assert.equal(envelope.dispositions.length, 2);
  assert.strictEqual(envelope.mints[0], mint);
  for (const [label, changed] of [
    ["source", { source: "legacy-unbound-reader" }],
    ["hash", { witnessSetHash: "d".repeat(64) }],
    ["count", { witnessCount: 3 }],
    ["preserve count", { witnessPreserveCount: 0 }],
    ["through height", { witnessedThroughBlock: rederiveBlockHeight - 1 }],
    ["through hash", { witnessedThroughBlockHash: "e".repeat(64) }],
  ]) {
    assert.equal(
      canonicalBoundInceptionWitnessEnvelope(
        { ...envelopePayload, ...changed },
        replayBinding,
        "livenet",
        envelopePayload.indexedThroughBlock,
        envelopePayload.checkpointHash,
      ),
      null,
      `${label} mismatch escaped the bound reader envelope`,
    );
  }

  const canonicalPwtReplayVerifierBindingDescriptor = isolatedFunction(
    API_PATH,
    "canonicalPwtReplayVerifierBindingDescriptor",
  );
  const canonicalPwtReplayVerifierBindingsEqual = isolatedFunction(
    API_PATH,
    "canonicalPwtReplayVerifierBindingsEqual",
  );
  const canonicalPwtReplayVerifierBindingCacheKey = isolatedFunction(
    API_PATH,
    "canonicalPwtReplayVerifierBindingCacheKey",
    { canonicalPwtReplayVerifierBindingDescriptor },
  );
  const normalizedBinding = canonicalPwtReplayVerifierBindingDescriptor(
    replayBinding,
    "livenet",
  );
  assert.ok(normalizedBinding);
  assert.equal(
    canonicalPwtReplayVerifierBindingsEqual(
      normalizedBinding,
      canonicalPwtReplayVerifierBindingDescriptor(
        { ...replayBinding, witnessCount: 3 },
        "livenet",
      ),
    ),
    false,
  );
  assert.equal(
    canonicalPwtReplayVerifierBindingsEqual(
      normalizedBinding,
      canonicalPwtReplayVerifierBindingDescriptor(
        { ...replayBinding, witnessedThroughBlockHash: "f".repeat(64) },
        "livenet",
      ),
    ),
    false,
  );
  assert.equal(
    canonicalPwtReplayVerifierBindingDescriptor(
      { ...replayBinding, witnessSetMetaKey: "wrong" },
      "livenet",
    ),
    null,
  );

  const previousHashes = new Map([
    [preserveBlockHash, preservePreviousBlockHash],
    [rederiveBlockHash, preserveBlockHash],
    [postCaptureBlockHash, rederiveBlockHash],
  ]);
  let liveSummaryReads = 0;
  const canonicalInceptionIssuanceOptions = isolatedFunction(
    API_PATH,
    "canonicalInceptionIssuanceOptions",
    {
      canonicalBoundInceptionWitnessSet,
      canonicalEventOrdinal,
      canonicalInceptionPreviousBlockHash: async (_network, bond) =>
        previousHashes.get(String(bond?.blockHash ?? "")) ?? "",
      canonicalInceptionValueSnapshotCheckpoint: (payload) =>
        payload?.checkpoint ?? null,
      canonicalPwtReplayVerifierBindingCacheKey,
      canonicalPwtReplayVerifierBindingDescriptor,
      canonicalStoredInceptionWitnessSet: () => null,
      cachedInternalVerifierState: async (_key, loader) => loader(),
      inceptionValueSnapshotUnavailableError: (_bond, details = {}) =>
        Object.assign(new Error(details.reason ?? "snapshot unavailable"), {
          details,
        }),
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      proofIndexCanonicalSummaryLedgerPayload: async (
        _network,
        height,
        blockHash,
      ) => {
        liveSummaryReads += 1;
        return {
          checkpoint: {
            blockHash:
              height === rederiveBlockHeight - 1
                ? rederiveBlockHash
                : postCaptureBlockHash,
            blockHeight: height + 1,
            blockIndex: 12,
            valueSnapshotBlockHash: blockHash,
            valueSnapshotBlockHeight: height,
            valueSnapshotCanonicalSummaryHash: "f".repeat(64),
            valueSnapshotGeneratedAt: "2026-07-18T20:02:00.000Z",
            valueSnapshotId: `live-h-minus-one-${height}`,
            valueSnapshotMode: "canonical-summary-refresh",
            valueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
            workNetworkValueQ8: "2100000000000000",
            workNetworkValueSats: "21000000",
          },
        };
      },
      samePaymentAddress,
    },
  );
  const preserveOptions = await canonicalInceptionIssuanceOptions(
    "livenet",
    [preserveBond],
    {
      boundWitnessDispositions: envelope.dispositions,
      preRangeMintWitnesses: envelope.mints,
      replayVerifierBinding: replayBinding,
    },
  );
  assert.equal(liveSummaryReads, 0);
  assert.equal(
    preserveOptions.preBondCheckpoint(preserveBond).workNetworkValueQ8,
    snapshotWorkNetworkValueQ8.toString(),
  );
  assert.strictEqual(
    preserveOptions.preRangeStoredMint(mint, preserveBond),
    mint,
    "preserve replay must reuse the committed mint byte-for-byte",
  );

  for (const [label, boundWitnessDispositions] of [
    ["missing", [rederiveDisposition]],
    [
      "corrupt",
      [
        canonicalBoundInceptionWitnessDisposition(
          {
            ...preserveEntry,
            mintPayload: {
              ...mint,
              issuanceNetworkValueQ8:
                (issuanceNetworkValueQ8 + 1n).toString(),
            },
          },
          replayBinding,
        ),
        rederiveDisposition,
      ],
    ],
  ]) {
    await rejection(
      canonicalInceptionIssuanceOptions("livenet", [preserveBond], {
        boundWitnessDispositions,
        replayVerifierBinding: replayBinding,
      }),
      (error) => error?.details?.reason === "stored-bound-witness-invalid",
      `${label} preserve disposition did not fail closed`,
    );
  }
  assert.equal(
    liveSummaryReads,
    0,
    "missing or corrupt preserve state must never fall through to live H-1",
  );
  await rejection(
    canonicalInceptionIssuanceOptions(
      "livenet",
      [{ ...preserveBond, blockIndex: preserveBond.blockIndex + 1 }],
      {
        boundWitnessDispositions: envelope.dispositions,
        replayVerifierBinding: replayBinding,
      },
    ),
    (error) => error?.details?.reason === "stored-bound-witness-invalid",
    "a preserve must remain bound to its exact Core block index",
  );
  assert.equal(liveSummaryReads, 0);

  const rederiveOptions = await canonicalInceptionIssuanceOptions(
    "livenet",
    [rederiveBond],
    {
      boundWitnessDispositions: envelope.dispositions,
      replayVerifierBinding: replayBinding,
    },
  );
  assert.equal(liveSummaryReads, 1);
  assert.equal(
    rederiveOptions.preBondCheckpoint(rederiveBond).valueSnapshotId,
    `live-h-minus-one-${rederiveBlockHeight - 1}`,
  );
  const postCaptureOptions = await canonicalInceptionIssuanceOptions(
    "livenet",
    [postCaptureBond],
    {
      boundWitnessDispositions: envelope.dispositions,
      replayVerifierBinding: replayBinding,
    },
  );
  assert.equal(liveSummaryReads, 2);
  assert.equal(
    postCaptureOptions.preBondCheckpoint(postCaptureBond)
      .valueSnapshotBlockHeight,
    postCaptureBlockHeight - 1,
  );

  const ledgerTokenStateForScope = (ledger, tokenId) =>
    tokenId === WORK_TOKEN_ID ? ledger.workTokenState : ledger.tokenState;
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID,
      canonicalEventOrdinal,
      ledgerTokenStateForScope,
      samePaymentAddress,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      WORK_TOKEN_MAX_SUPPLY,
      inceptionAttachmentMatchesForBond,
      inceptionMintHasCanonicalBondBinding,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      samePaymentAddress,
    },
  );
  const ledger = {
    network: "livenet",
    tokenState: { mints: [mint] },
    workTokenState: {
      transfers: [
        {
          amount: "1",
          amountAtoms: attachedWorkAmountAtoms,
          blockHash: preserveBlockHash,
          blockHeight: preserveBlockHeight,
          blockIndex: preserveBond.blockIndex,
          confirmed: true,
          protocolVout: 4,
          recipientAddress: address,
          tokenId: WORK_TOKEN_ID,
          txid: preserveTxid,
          valid: true,
        },
      ],
    },
  };
  const [accepted] = inceptionMintsWithLiveIssuance(
    [mint],
    [preserveBond],
    ledger,
    preserveOptions,
  );
  assert.strictEqual(accepted, mint);
  const [atomMismatch] = inceptionMintsWithLiveIssuance(
    [mint],
    [preserveBond],
    {
      ...ledger,
      workTokenState: {
        transfers: [
          {
            ...ledger.workTokenState.transfers[0],
            amountAtoms: "99999999",
          },
        ],
      },
    },
    preserveOptions,
  );
  assert.equal(
    inceptionIssuanceMetadataFromMints([atomMismatch]).complete,
    false,
    "the immutable preserve cannot override replayed WORK atom conservation",
  );
});

check("range-replay cutoff keeps live H-1 and binding-separated verifier caches", async () => {
  const PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL =
    "proof-indexer-pwt-range-replay-verifier-binding-v1";
  const rangeReplayFromHeight = 958_383;
  const replayVerifierBinding = replayVerifierBindingFixture({
    bindingId: "a".repeat(64),
    createdAt: "2026-07-18T20:00:00.000Z",
    rangeReplayFromHeight,
    witnessedThroughBlock: rangeReplayFromHeight - 1,
    witnessedThroughBlockHash: "4".repeat(64),
  });
  const canonicalPwtReplayVerifierBindingDescriptor = isolatedFunction(
    API_PATH,
    "canonicalPwtReplayVerifierBindingDescriptor",
    {
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: rangeReplayFromHeight,
      PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
    },
  );
  const canonicalPwtReplayVerifierBindingCacheKey = isolatedFunction(
    API_PATH,
    "canonicalPwtReplayVerifierBindingCacheKey",
    { canonicalPwtReplayVerifierBindingDescriptor },
  );
  const replayCacheSuffix =
    `:replay:${replayVerifierBinding.bindingId}` +
    `:from${rangeReplayFromHeight}:at${Date.parse(
      replayVerifierBinding.createdAt,
    )}` +
    `:witness:${replayVerifierBinding.witnessModel}` +
    `:${replayVerifierBinding.witnessSetHash}` +
    `:${replayVerifierBinding.witnessCount}` +
    `:${replayVerifierBinding.witnessPreserveCount}` +
    `:through${replayVerifierBinding.witnessedThroughBlock}` +
    `:${replayVerifierBinding.witnessedThroughBlockHash}`;
  assert.equal(
    canonicalPwtReplayVerifierBindingCacheKey(
      replayVerifierBinding,
      "livenet",
    ),
    replayCacheSuffix,
  );

  const c9Txid =
    "c9c9f4e382f598aa39b3be57adc8fe1defeb80e5216387d3af6b0948da232aff";
  const c9BlockHash =
    "00000000000000000001db52a4485f7d1a1784b7ba6c5b93db1b20449ac2628b";
  const c9PreviousBlockHash = "b".repeat(64);
  const c9Bond = {
    blockHash: c9BlockHash,
    blockHeight: rangeReplayFromHeight,
    blockIndex: 2_421,
    confirmed: true,
    kind: "inception-bond",
    network: "livenet",
    recipients: [
      {
        address:
          "bc1pxhs9y9ryqnhm05lyv794f6upzk0mtu2zct5w2hgc2vm3d58pvcqspptre0",
        amountSats: 1_000,
        vout: 0,
      },
    ],
    txid: c9Txid,
  };
  const liveCheckpoint = {
    blockHash: c9BlockHash,
    blockHeight: rangeReplayFromHeight,
    blockIndex: 2_421,
    valueSnapshotBlockHash: c9PreviousBlockHash,
    valueSnapshotBlockHeight: rangeReplayFromHeight - 1,
    valueSnapshotCanonicalSummaryHash: "c".repeat(64),
    valueSnapshotGeneratedAt: "2026-07-18T20:01:00.000Z",
    valueSnapshotId: "c9-live-h-minus-one",
    valueSnapshotMode: "canonical-summary-refresh",
    valueSnapshotModel: "canonical-summary-h-minus-one-v1",
    workNetworkValueQ8: "64119182598841790000000",
    workNetworkValueSats: "641191825988417.9",
  };
  let liveSummaryReads = 0;
  let liveSummaryUnavailable = false;
  const hMinusOneCacheKeys = [];
  const canonicalInceptionIssuanceOptions = isolatedFunction(
    API_PATH,
    "canonicalInceptionIssuanceOptions",
    {
      canonicalInceptionPreviousBlockHash: async () => c9PreviousBlockHash,
      canonicalInceptionValueSnapshotCheckpoint: (snapshot) =>
        snapshot?.checkpoint ?? null,
      canonicalPwtReplayVerifierBindingCacheKey,
      canonicalPwtReplayVerifierBindingDescriptor,
      canonicalStoredInceptionWitnessSet: () => ({
        checkpoint: { ...liveCheckpoint, valueSnapshotId: "wrong-witness" },
        mints: [{}],
      }),
      cachedInternalVerifierState: async (key, loader) => {
        hMinusOneCacheKeys.push(key);
        return loader();
      },
      inceptionValueSnapshotUnavailableError: (_bond, details = {}) =>
        Object.assign(new Error(details.reason ?? "snapshot unavailable"), {
          details,
        }),
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      proofIndexCanonicalSummaryLedgerPayload: async () => {
        liveSummaryReads += 1;
        if (liveSummaryUnavailable) {
          throw new Error("live H-1 summary required");
        }
        return { checkpoint: liveCheckpoint };
      },
    },
  );
  const cutoffOptions = await canonicalInceptionIssuanceOptions(
    "livenet",
    [c9Bond],
    {
      preRangeMintWitnesses: [{}],
      replayVerifierBinding,
    },
  );
  assert.equal(liveSummaryReads, 1);
  assert.equal(
    cutoffOptions.preBondCheckpoint(c9Bond).valueSnapshotId,
    "c9-live-h-minus-one",
    "the exact replay cutoff must use the live H-1 summary, not a stored witness",
  );
  assert.ok(hMinusOneCacheKeys[0].endsWith(replayCacheSuffix));

  liveSummaryUnavailable = true;
  for (const blockHeight of [rangeReplayFromHeight, rangeReplayFromHeight + 1]) {
    const candidate = {
      ...c9Bond,
      blockHash:
        blockHeight === rangeReplayFromHeight
          ? c9BlockHash
          : "d".repeat(64),
      blockHeight,
      txid:
        blockHeight === rangeReplayFromHeight ? c9Txid : "e".repeat(64),
    };
    await rejection(
      canonicalInceptionIssuanceOptions("livenet", [candidate], {
        preRangeMintWitnesses: [{}],
        replayVerifierBinding,
      }),
      (error) => /live H-1 summary required/u.test(error.message),
      `block ${blockHeight} improperly used a pre-range witness`,
    );
  }

  const contextCacheKeys = [];
  const loadedBindings = [];
  const canonicalVerifierContextFromCheckpoint = isolatedFunction(
    API_PATH,
    "canonicalVerifierContextFromCheckpoint",
    {
      cachedInternalVerifierState: async (key, loader) => {
        contextCacheKeys.push(key);
        return loader();
      },
      canonicalPwtReplayVerifierBindingCacheKey,
      canonicalPwtReplayVerifierBindingDescriptor,
      internalReplayVerifierBindingError: (message) => new Error(message),
      loadCanonicalVerifierContextFromCheckpoint: async (
        _network,
        _height,
        _blockHash,
        _previousBlockHash,
        binding,
      ) => {
        loadedBindings.push(binding);
        return { binding };
      },
      pruneInternalVerifierStateCache: () => {},
    },
  );
  await canonicalVerifierContextFromCheckpoint(
    "livenet",
    rangeReplayFromHeight,
    c9BlockHash,
    c9PreviousBlockHash,
    replayVerifierBinding,
  );
  await canonicalVerifierContextFromCheckpoint(
    "livenet",
    rangeReplayFromHeight,
    c9BlockHash,
    c9PreviousBlockHash,
  );
  assert.ok(contextCacheKeys[0].endsWith(replayCacheSuffix));
  assert.ok(!contextCacheKeys[1].includes(":replay:"));
  assert.notEqual(contextCacheKeys[0], contextCacheKeys[1]);
  assert.equal(loadedBindings[0].bindingId, replayVerifierBinding.bindingId);
  assert.equal(loadedBindings[1], null);

  const completeTokenVerifierSource = topLevelFunctionSource(
    API_PATH,
    "completeTokenVerifierState",
  );
  assert.match(
    completeTokenVerifierSource,
    /canonicalVerifierContextFromCheckpoint\([\s\S]*replayVerifierBinding/u,
  );
  assert.match(
    completeTokenVerifierSource,
    /proofIndexCanonicalInceptionMintWitnessesPayload\([\s\S]*canonicalBoundInceptionWitnessEnvelope\([\s\S]*context\.previousBlockHash/u,
  );
  assert.match(
    completeTokenVerifierSource,
    /canonicalInceptionIssuanceOptions\([\s\S]*preRangeMintWitnesses[\s\S]*replayVerifierBinding/u,
  );
  const canonicalContextSource = topLevelFunctionSource(
    API_PATH,
    "loadCanonicalVerifierContextFromCheckpoint",
  );
  assert.match(
    canonicalContextSource,
    /canonicalPwtReplayVerifierBindingsEqual\(priorBinding, replayBinding\)/u,
  );
  const issuanceOptionsSource = topLevelFunctionSource(
    API_PATH,
    "canonicalInceptionIssuanceOptions",
  );
  assert.match(
    issuanceOptionsSource,
    /bondBlockHeight\s*<\s*replayBinding\.rangeReplayFromHeight/u,
  );
  assert.match(
    issuanceOptionsSource,
    /incb-value-snapshot-source:[\s\S]*replayBindingCacheKey/u,
  );
});

check("pre-range rejected INCB dispositions cannot be resurrected by witnesses", async () => {
  const txid =
    "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21";
  const bond = {
    confirmed: true,
    kind: "inception-bond",
    txid,
  };
  const invalidEvent = {
    attemptedKind: "token-mint",
    confirmed: true,
    kind: "token-event-invalid",
    sourceBondTxid: txid,
    sourceKind: "inception-bond",
    tokenId: INCB_TOKEN_ID,
    txid,
    valid: false,
  };
  const inceptionInvalidMintDispositionMatchesBond = isolatedFunction(
    API_PATH,
    "inceptionInvalidMintDispositionMatchesBond",
    {
      INCB_TOKEN_ID,
      INCEPTION_BOND_CONFIG: { kind: "inception-bond" },
    },
  );
  const inceptionBondHasExplicitlyRejectedMint = isolatedFunction(
    API_PATH,
    "inceptionBondHasExplicitlyRejectedMint",
    {
      INCB_TOKEN_ID,
      inceptionInvalidMintDispositionMatchesBond,
    },
  );
  const inceptionVerifierBondActivity = isolatedFunction(
    API_PATH,
    "inceptionVerifierBondActivity",
    {
      inceptionBondHasExplicitlyRejectedMint,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
    },
  );
  assert.deepEqual(
    Array.from(
      inceptionVerifierBondActivity([bond], {
        invalidEvents: [invalidEvent],
        mints: [],
      }),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      inceptionVerifierBondActivity([bond], {
        invalidEvents: [invalidEvent],
        mints: [{ confirmed: true, tokenId: INCB_TOKEN_ID, txid }],
      }),
    ),
    [bond],
    "an existing mint remains reconciliation input instead of being hidden by a sibling invalid row",
  );

  const completeTokenVerifierSource = topLevelFunctionSource(
    API_PATH,
    "completeTokenVerifierState",
  );
  assert.match(
    completeTokenVerifierSource,
    /inceptionVerifierBondActivity\([\s\S]*context\.priorInvalidEvents/u,
  );
  const witnessReaderSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexCanonicalInceptionMintWitnessesPayload",
  );
  assert.match(
    witnessReaderSource,
    /invalidTxids\.has\(normalizedLowerText\(mint\.txid\)\)/u,
  );
  assert.match(
    witnessReaderSource,
    /identities\.has\(identity\)/u,
  );
});

check("internal replay verifier rejects a missing or different database binding", async () => {
  const model = "proof-indexer-pwt-range-replay-verifier-binding-v1";
  const bindingId = "a".repeat(64);
  let rebuild = {
    active: true,
    complete: false,
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 958383,
    status: "active",
    verifierBinding: replayVerifierBindingFixture({
      bindingId,
      createdAt: "2026-07-18T20:00:00.000Z",
      rangeReplayFromHeight: 958383,
    }),
  };
  const canonicalInternalPwtRangeReplayState = isolatedFunction(
    API_PATH,
    "canonicalInternalPwtRangeReplayState",
  );
  const canonicalInternalReplayVerifierBinding = isolatedFunction(
    API_PATH,
    "canonicalInternalReplayVerifierBinding",
    {
      PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL: model,
      canonicalInternalPwtRangeReplayState,
      canonicalPwtReplayVerifierBindingDescriptor:
        isolatedFunction(
          API_PATH,
          "canonicalPwtReplayVerifierBindingDescriptor",
        ),
    },
  );
  const internalReplayVerifierBindingError = isolatedFunction(
    API_PATH,
    "internalReplayVerifierBindingError",
  );
  const internalReplayVerifierBinding = isolatedFunction(
    API_PATH,
    "internalReplayVerifierBinding",
    {
      Buffer,
      canonicalInternalPwtRangeReplayState,
      canonicalInternalReplayVerifierBinding,
      internalReplayVerifierBindingError,
      proofIndexCanonicalStateMetaPayload: async () => ({ rebuild }),
      timingSafeEqual,
    },
  );

  const accepted = await internalReplayVerifierBinding("livenet", bindingId);
  assert.equal(accepted.bindingId, bindingId);
  let confirmedBinding = accepted;
  const internalReplayBoundPayload = isolatedFunction(
    API_PATH,
    "internalReplayBoundPayload",
    {
      canonicalPwtReplayVerifierBindingsEqual:
        isolatedFunction(
          API_PATH,
          "canonicalPwtReplayVerifierBindingsEqual",
        ),
      internalReplayVerifierBinding: async () => confirmedBinding,
      internalReplayVerifierBindingError,
    },
  );
  const boundPayload = await internalReplayBoundPayload(
    "livenet",
    bindingId,
    { ok: true },
    accepted,
  );
  assert.equal(boundPayload.replayVerifierBinding.bindingId, bindingId);
  confirmedBinding = { ...accepted, bindingId: "b".repeat(64) };
  await rejection(
    internalReplayBoundPayload(
      "livenet",
      bindingId,
      { ok: true },
      accepted,
    ),
    (error) => /binding changed/u.test(error.message),
    "an API response must revalidate its database binding after payload build",
  );
  await rejection(
    internalReplayVerifierBinding("livenet", "b".repeat(64)),
    (error) =>
      error?.details?.code ===
      "PWT_RANGE_REPLAY_DATABASE_BINDING_MISMATCH",
    "an API backed by a different database must not satisfy replay",
  );
  await rejection(
    internalReplayVerifierBinding("livenet", ""),
    (error) => /requires its database binding/u.test(error.message),
    "an active replay API must reject unbound internal reads",
  );

  rebuild = { ...rebuild, active: false };
  await rejection(
    internalReplayVerifierBinding("livenet", ""),
    (error) =>
      error?.details?.code ===
        "PWT_RANGE_REPLAY_DATABASE_BINDING_MISMATCH" &&
      /metadata is malformed/u.test(error.message),
    "malformed active flags must fail closed instead of disabling binding",
  );

  rebuild = null;
  assert.equal(await internalReplayVerifierBinding("livenet", ""), null);
  await rejection(
    internalReplayVerifierBinding("livenet", bindingId),
    (error) => /not connected to the requested replay database/u.test(error.message),
    "a production API without clone metadata must reject the clone binding",
  );
});

check("backfill rejects an internal response not echoed by its replay database", () => {
  const expected = {
    bindingId: "c".repeat(64),
    createdAt: "2026-07-18T20:00:00.000Z",
    model: "proof-indexer-pwt-range-replay-verifier-binding-v1",
    network: "livenet",
    rangeReplayFromHeight: 958383,
  };
  const assertInternalReplayVerifierResponseBinding = isolatedFunction(
    BACKFILL_PATH,
    "assertInternalReplayVerifierResponseBinding",
    { ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING: expected },
  );
  const endpoint = isolatedFunction(BACKFILL_PATH, "endpoint", {
    ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING: expected,
    API_BASE: "http://127.0.0.1:8099",
    NETWORK: "livenet",
    PAGE_LIMIT: 200,
    URL,
  });
  assert.equal(
    endpoint("/api/v1/internal/token-verifier").searchParams.get(
      "replayBindingId",
    ),
    expected.bindingId,
  );
  assert.equal(
    endpoint("/api/v1/internal/token-verifier", {
      replayBindingId: "d".repeat(64),
    }).searchParams.get("replayBindingId"),
    expected.bindingId,
    "call parameters cannot override the active database binding",
  );
  assert.equal(
    endpoint("/api/v1/token-history").searchParams.has("replayBindingId"),
    false,
    "the database binding must never leak onto public API requests",
  );
  const url = new URL("http://127.0.0.1:8099/api/v1/internal/token-verifier");
  const payload = { replayVerifierBinding: { ...expected } };
  assert.equal(
    assertInternalReplayVerifierResponseBinding(payload, url),
    payload,
  );
  assert.throws(
    () =>
      assertInternalReplayVerifierResponseBinding(
        {
          replayVerifierBinding: {
            ...expected,
            bindingId: "d".repeat(64),
          },
        },
        url,
      ),
    /wrong ProofOfWork database/u,
  );
  assert.throws(
    () =>
      assertInternalReplayVerifierResponseBinding(
        {
          replayVerifierBinding: {
            ...expected,
            createdAt: "2026-07-18T20:00:01.000Z",
          },
        },
        url,
      ),
    /wrong ProofOfWork database/u,
  );
  assert.throws(
    () => assertInternalReplayVerifierResponseBinding({}, url),
    /wrong ProofOfWork database/u,
  );
});

check("completed replay automatically authenticates ordinary internal verifier reads", async () => {
  const binding = replayVerifierBindingFixture({
    bindingId: "f".repeat(64),
    createdAt: "2026-07-18T20:00:00.000Z",
    rangeReplayFromHeight: 958383,
  });
  const internalReplayVerifierBinding = isolatedFunction(
    API_PATH,
    "internalReplayVerifierBinding",
    {
      Buffer,
      canonicalInternalPwtRangeReplayState: () => "complete",
      canonicalInternalReplayVerifierBinding: () => binding,
      internalReplayVerifierBindingError: isolatedFunction(
        API_PATH,
        "internalReplayVerifierBindingError",
      ),
      proofIndexCanonicalStateMetaPayload: async () => ({
        rebuild: { status: "complete" },
      }),
      timingSafeEqual,
    },
  );
  assert.deepEqual(
    await internalReplayVerifierBinding("livenet", ""),
    binding,
  );
});

check("active and completed range replay cannot use an implicit or unbound API", () => {
  const binding = {
    bindingId: "e".repeat(64),
    createdAt: "2026-07-18T20:00:00.000Z",
    model: "proof-indexer-pwt-range-replay-verifier-binding-v1",
    network: "livenet",
    rangeReplayFromHeight: 958383,
  };
  const rebuild = {
    active: true,
    complete: false,
    mode: "pwt-range-replay",
    status: "active",
  };
  const activateWithImplicitApi = isolatedFunction(
    BACKFILL_PATH,
    "activatePwtRangeReplayVerifierBinding",
    {
      ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING: null,
      assertCanonicalPwtRangeReplayState: () => "active",
      canonicalPwtRangeReplayVerifierBinding: () => binding,
      explicitLoopbackApiBaseConfigured: () => false,
    },
  );
  assert.throws(
    () => activateWithImplicitApi(rebuild),
    /explicit loopback POW_API_BASE/u,
  );

  const activateWithoutBinding = isolatedFunction(
    BACKFILL_PATH,
    "activatePwtRangeReplayVerifierBinding",
    {
      ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING: null,
      assertCanonicalPwtRangeReplayState: () => "active",
      canonicalPwtRangeReplayVerifierBinding: () => null,
      explicitLoopbackApiBaseConfigured: () => true,
    },
  );
  assert.throws(
    () => activateWithoutBinding(rebuild),
    /missing its canonical verifier database binding/u,
  );

  const activateBoundReplay = isolatedFunction(
    BACKFILL_PATH,
    "activatePwtRangeReplayVerifierBinding",
    {
      ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING: null,
      assertCanonicalPwtRangeReplayState: () => "active",
      canonicalPwtRangeReplayVerifierBinding: () => binding,
      explicitLoopbackApiBaseConfigured: () => true,
    },
  );
  assert.deepEqual(activateBoundReplay(rebuild), binding);

  const activateCompletedReplay = isolatedFunction(
    BACKFILL_PATH,
    "activatePwtRangeReplayVerifierBinding",
    {
      ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING: null,
      assertCanonicalPwtRangeReplayState: () => "complete",
      canonicalPwtRangeReplayVerifierBinding: () => binding,
      explicitLoopbackApiBaseConfigured: () => true,
    },
  );
  assert.deepEqual(
    activateCompletedReplay({
      ...rebuild,
      active: false,
      complete: true,
      status: "complete",
    }),
    binding,
    "ordinary catch-up must keep using the completed replay's immutable witness binding",
  );
});

check("active range replay is fail-closed to one block-scan source", async () => {
  const rebuild = {
    active: true,
    complete: false,
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 958383,
    status: "active",
  };
  const globals = {
    AUDIT_WORK_ATOMS_ONLY: false,
    BLOCK_SCAN_FROM_HEIGHT: 958383,
    CANONICAL_REBUILD: false,
    CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
    DB_SUMMARY_REPAIR: false,
    HYDRATE_TRANSACTION_DETAILS_ONLY: false,
    MIGRATE_WORK_ATOMS_ONLY: false,
    PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
    PREPARE_CANONICAL_REBUILD_ONLY: false,
    REPAIR_CANONICAL_TXIDS_ONLY: false,
    REPAIR_ID_TXIDS_ONLY: false,
    REPAIR_INCB_ISSUANCE_ONLY: false,
    REPAIR_WORK_PARTICIPANTS_ONLY: false,
    RUSH_BOOTSTRAP_ONLY: false,
    STORE_CANONICAL_SUMMARY_SNAPSHOT: false,
    STORE_LEDGER_SNAPSHOT: false,
    VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY: false,
    activatePwtRangeReplayVerifierBinding: () => ({
      bindingId: "f".repeat(64),
    }),
    assertCanonicalWorkAtomicSource: async () => ({
      audit: { atomic: true, legacy: false },
      conservation: {
        balanceSupply: "2100000000000000",
        mintedSupply: "2100000000000000",
      },
    }),
    assertCanonicalPwtRangeReplayState: () => "active",
    legacyCompletedPwtRangeReplayCanBeReprepared: () => false,
    proofIndexerMetaValue: async () => rebuild,
  };
  const broadRuntime = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayRuntime",
    {
      ...globals,
      SOURCES: [
        { blockScan: true, label: "block-scan" },
        { label: "tokens", path: "/api/v1/token-history" },
      ],
    },
  );
  await rejection(
    broadRuntime({}),
    (error) => /block-scan-only pass/u.test(error.message),
    "a broad API source must never refill an active replay database",
  );

  const ledgerRuntime = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayRuntime",
    {
      ...globals,
      SOURCES: [{ blockScan: true, label: "block-scan" }],
      STORE_LEDGER_SNAPSHOT: true,
    },
  );
  await rejection(
    ledgerRuntime({}),
    (error) => /block-scan-only pass/u.test(error.message),
    "general ledger storage must remain disabled during active replay",
  );

  const boundRuntime = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayRuntime",
    {
      ...globals,
      SOURCES: [{ blockScan: true, label: "block-scan" }],
    },
  );
  const accepted = await boundRuntime({});
  assert.equal(accepted.active, true);
  assert.equal(accepted.verifierBinding.bindingId, "f".repeat(64));

  const hybridRuntime = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayRuntime",
    {
      ...globals,
      SOURCES: [{ blockScan: true, label: "block-scan" }],
      assertCanonicalWorkAtomicSource: async () => {
        throw new Error(
          "Active PWT range replay requires the exact canonical WORK work-atoms-v1 definition.",
        );
      },
    },
  );
  await rejection(
    hybridRuntime({}),
    (error) => /work-atoms-v1 definition/u.test(error.message),
    "an already-prepared replay must not continue with a hybrid WORK definition",
  );

  const mismatchedConservationRuntime = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayRuntime",
    {
      ...globals,
      SOURCES: [{ blockScan: true, label: "block-scan" }],
      assertCanonicalWorkAtomicSource: async () => {
        throw new Error(
          "Canonical WORK atomic conservation failed: mints 2100000000000000, balances 2099999999999999.",
        );
      },
    },
  );
  await rejection(
    mismatchedConservationRuntime({}),
    (error) => /atomic conservation failed/u.test(error.message),
    "an active replay resume must recheck event/balance conservation, not only its definition",
  );
});

check("malformed range replay flags cannot disable replay safeguards", () => {
  const canonicalPwtRangeReplayVerificationIsValid = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayVerificationIsValid",
    {
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: 958383,
      NETWORK: "livenet",
      canonicalIncbPwtRangeReplayTargets: () =>
        CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE,
      objectValue: (value) => value ?? {},
    },
  );
  const canonicalPwtRangeReplayState = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayState",
    {
      NETWORK: "livenet",
      canonicalPwtRangeReplayVerificationIsValid,
      objectValue: (value) => value ?? {},
    },
  );
  const assertCanonicalPwtRangeReplayState = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalPwtRangeReplayState",
    { canonicalPwtRangeReplayState },
  );
  const verifierBinding = replayVerifierBindingFixture({
    bindingId: "e".repeat(64),
    createdAt: "2026-07-18T20:00:00.000Z",
  });
  const common = {
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 958383,
    verifierBinding,
  };
  const completeProof = {
    accountingModel: "canonical-pre-bond-live-network-value-v2",
    consumedPreserveCount: verifierBinding.witnessPreserveCount,
    coreFacts: CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.map(
      ({ blockHash, blockHeight, blockIndex, txid, workAmountAtoms }) => ({
        blockHash,
        blockHeight,
        blockIndex,
        txid,
        workAmountAtoms,
      }),
    ),
    rangeReplayFromHeight: 958383,
    preservedWitnesses: [],
    rederivedWitnessCount:
      verifierBinding.witnessCount - verifierBinding.witnessPreserveCount,
    rederivedWitnesses: [],
    targets: CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.map(
      ({ txid, workAmountAtoms }) => ({
        confirmedIssuanceUnits: "1001",
        issuanceNetworkValueQ8: "100100000000",
        txid,
        workAmountAtoms,
      }),
    ),
    verified: true,
    witnessCount: verifierBinding.witnessCount,
    witnessPreserveCount: verifierBinding.witnessPreserveCount,
    witnessedThroughBlock: verifierBinding.witnessedThroughBlock,
    witnessedThroughBlockHash:
      verifierBinding.witnessedThroughBlockHash,
    witnessSetHash: verifierBinding.witnessSetHash,
  };
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: true,
      complete: false,
      status: "active",
    }),
    "active",
  );
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: false,
      complete: true,
      completedAt: "2026-07-18T20:30:00.000Z",
      incbRangeReplayVerification: completeProof,
      status: "complete",
    }),
    "complete",
  );
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: false,
      complete: true,
      status: "complete",
    }),
    "invalid",
    "a bare complete tuple must not bypass the replay verification proof",
  );
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: false,
      complete: true,
      completedAt: "2026-07-18T20:30:00.000Z",
      incbRangeReplayVerification: completeProof,
      status: "complete",
      verifierBinding: null,
    }),
    "invalid",
    "completion must retain its exact replay verifier database binding",
  );
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: false,
      complete: true,
      completedAt: "not-a-date",
      incbRangeReplayVerification: completeProof,
      status: "complete",
    }),
    "invalid",
    "completion time must be nonempty and parseable",
  );
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: false,
      complete: true,
      completedAt: "2026-07-18T20:30:00.000Z",
      incbRangeReplayVerification: {
        ...completeProof,
        verified: false,
      },
      status: "complete",
    }),
    "invalid",
    "the range verifier must explicitly attest verified true",
  );
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: false,
      complete: true,
      completedAt: "2026-07-18T20:30:00.000Z",
      incbRangeReplayVerification: {
        ...completeProof,
        coreFacts: completeProof.coreFacts.slice(1),
        targets: completeProof.targets.slice(1),
      },
      status: "complete",
    }),
    "invalid",
    "completion must attest the exact four incident-pinned replay targets",
  );
  const substitutedTxid = "f".repeat(64);
  assert.equal(
    canonicalPwtRangeReplayVerificationIsValid({
      ...common,
      incbRangeReplayVerification: {
        ...completeProof,
        coreFacts: [
          ...completeProof.coreFacts.slice(0, -1),
          {
            ...completeProof.coreFacts.at(-1),
            txid: substitutedTxid,
          },
        ],
        targets: [
          ...completeProof.targets.slice(0, -1),
          {
            ...completeProof.targets.at(-1),
            txid: substitutedTxid,
          },
        ],
      },
    }),
    false,
    "a substituted target must not satisfy the pinned incident set",
  );
  assert.equal(
    canonicalPwtRangeReplayVerificationIsValid({
      ...common,
      incbRangeReplayVerification: {
        ...completeProof,
        coreFacts: [
          ...completeProof.coreFacts,
          {
            ...completeProof.coreFacts[0],
            txid: substitutedTxid,
          },
        ],
        targets: [
          ...completeProof.targets,
          {
            ...completeProof.targets[0],
            txid: substitutedTxid,
          },
        ],
      },
    }),
    false,
    "an extra target must not satisfy the pinned incident set",
  );
  assert.equal(
    canonicalPwtRangeReplayVerificationIsValid({
      ...common,
      incbRangeReplayVerification: {
        ...completeProof,
        targets: completeProof.targets.map((target, index) =>
          index === 0
            ? { ...target, confirmedIssuanceUnits: "1000" }
            : target,
        ),
      },
    }),
    false,
    "certificate units must be the exact floor of issuance Q8",
  );
  const malformed = {
    ...common,
    active: false,
    complete: false,
    status: "active",
  };
  assert.equal(canonicalPwtRangeReplayState(malformed), "invalid");
  assert.throws(
    () => assertCanonicalPwtRangeReplayState(malformed),
    /metadata is malformed/u,
  );
  assert.equal(
    canonicalPwtRangeReplayState({
      ...common,
      active: true,
      complete: false,
      incbRangeReplayVerification: { verifiedAt: "2026-07-17T00:00:00Z" },
      status: "active",
    }),
    "invalid",
    "active metadata cannot carry a prior run's verification proof",
  );
});

check("only explicit preparation recognizes a complete legacy PWT replay", async () => {
  const legacyCompletedPwtRangeReplayCanBeReprepared = isolatedFunction(
    BACKFILL_PATH,
    "legacyCompletedPwtRangeReplayCanBeReprepared",
    {
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: 958383,
      LEGACY_PWT_CANONICAL_BOOTSTRAP_HASH:
        "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986",
      LEGACY_PWT_CANONICAL_BOOTSTRAP_HEIGHT: 947999,
      LEGACY_PWT_CANONICAL_FROM_HEIGHT: 948000,
      LEGACY_PWT_RANGE_REPLAY_FROM_HEIGHT: 950200,
      NETWORK: "livenet",
      objectValue: (value) => value ?? {},
    },
  );
  const legacy = {
    active: false,
    bootstrapHash:
      "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986",
    bootstrapHeight: 947999,
    complete: true,
    completedAt: "2026-07-18T19:29:05.182Z",
    fromHeight: 948000,
    indexedThroughBlock: 958602,
    indexedThroughBlockHash: "b".repeat(64),
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 950200,
    rangeReplayStartedAt: "2026-07-11T20:13:36.954Z",
    startedAt: "2026-07-11T17:14:57.622Z",
    status: "complete",
    transactionNormalization: "canonical-raw-tx-only",
  };
  assert.equal(
    legacyCompletedPwtRangeReplayCanBeReprepared(legacy, 958383),
    true,
  );
  for (const malformed of [
    { ...legacy, active: true },
    { ...legacy, complete: false },
    { ...legacy, fault: { active: true } },
    { ...legacy, verifierBinding: {} },
    { ...legacy, incbRangeReplayVerification: {} },
    { ...legacy, bootstrapHash: "not-a-hash" },
    { ...legacy, indexedThroughBlock: 950198 },
    { ...legacy, transactionNormalization: "legacy" },
  ]) {
    assert.equal(
      legacyCompletedPwtRangeReplayCanBeReprepared(malformed, 958383),
      false,
    );
  }
  assert.equal(
    legacyCompletedPwtRangeReplayCanBeReprepared(legacy, 958384),
    false,
  );

  let strictReads = 0;
  const globals = {
    BLOCK_SCAN_FROM_HEIGHT: 958383,
    CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
    PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
    assertCanonicalPwtRangeReplayState: () => {
      strictReads += 1;
      throw new Error("strict replay reader rejected legacy metadata");
    },
    legacyCompletedPwtRangeReplayCanBeReprepared,
    proofIndexerMetaValue: async () => legacy,
  };
  const ordinaryRuntime = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayRuntime",
    globals,
  );
  await rejection(
    ordinaryRuntime({}),
    (error) => /strict replay reader rejected/u.test(error.message),
  );
  assert.equal(strictReads, 1);

  const preparationRuntime = isolatedFunction(
    BACKFILL_PATH,
    "canonicalPwtRangeReplayRuntime",
    {
      ...globals,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
    },
  );
  const preparationState = await preparationRuntime({});
  assert.equal(preparationState.active, false);
  assert.equal(preparationState.preparing, true);
  assert.equal(preparationState.rebuild, legacy);
  assert.equal(preparationState.state, "legacy-complete");
  assert.equal(
    strictReads,
    1,
    "the explicit migration gate must not reclassify ordinary reads",
  );
});

check("public reads reject the production-shaped legacy PWT completion", async () => {
  const verifierBinding = replayVerifierBindingFixture({
    bindingId: "e".repeat(64),
    createdAt: "2026-07-18T20:00:00.000Z",
    witnessCount: 2,
    witnessPreserveCount: 1,
  });
  const preservedWitnesses = [
    {
      bondRecipientVout: 0,
      identity: `${"1".repeat(64)}:0`,
      mintPayloadHash: "2".repeat(64),
      snapshotFingerprint: "3".repeat(64),
      snapshotId: "preserved-completion-snapshot",
      txid: "1".repeat(64),
    },
  ];
  const rederivedWitnesses = [
    {
      bondRecipientVout: 1,
      disposition: "mint",
      identity: `${"4".repeat(64)}:1`,
      mintPayloadHash: "5".repeat(64),
      snapshotFingerprint: "6".repeat(64),
      snapshotId: "rederived-completion-snapshot",
      txid: "4".repeat(64),
    },
  ];
  const verification = {
    accountingModel: "canonical-pre-bond-live-network-value-v2",
    consumedPreserveCount: verifierBinding.witnessPreserveCount,
    coreFacts: CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.map(
      ({ blockHash, blockHeight, blockIndex, txid, workAmountAtoms }) => ({
        blockHash,
        blockHeight,
        blockIndex,
        txid,
        workAmountAtoms,
      }),
    ),
    rangeReplayFromHeight: 958383,
    preservedWitnesses,
    rederivedWitnessCount:
      verifierBinding.witnessCount - verifierBinding.witnessPreserveCount,
    rederivedWitnesses,
    targets: CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.map(
      ({ txid, workAmountAtoms }) => ({
        confirmedIssuanceUnits: "1001",
        issuanceNetworkValueQ8: "100100000000",
        txid,
        workAmountAtoms,
      }),
    ),
    verified: true,
    witnessCount: verifierBinding.witnessCount,
    witnessPreserveCount: verifierBinding.witnessPreserveCount,
    witnessedThroughBlock: verifierBinding.witnessedThroughBlock,
    witnessedThroughBlockHash:
      verifierBinding.witnessedThroughBlockHash,
    witnessSetHash: verifierBinding.witnessSetHash,
  };
  const canonicalPwtRangeReplayVerificationIsValid = isolatedFunction(
    API_PATH,
    "canonicalPwtRangeReplayVerificationIsValid",
    {
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: 958383,
      CANONICAL_INCB_PWT_RANGE_REPLAY_TARGETS:
        CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
    },
  );
  const canonicalInternalPwtRangeReplayState = isolatedFunction(
    API_PATH,
    "canonicalInternalPwtRangeReplayState",
    { canonicalPwtRangeReplayVerificationIsValid },
  );
  const canonicalRebuildTrustState = isolatedFunction(
    API_PATH,
    "canonicalRebuildTrustState",
    { canonicalInternalPwtRangeReplayState },
  );
  const common = {
    active: false,
    bootstrapHash:
      "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986",
    bootstrapHeight: 947999,
    complete: true,
    completedAt: "2026-07-18T19:29:05.182Z",
    fromHeight: 948000,
    indexedThroughBlock: 958602,
    indexedThroughBlockHash:
      "00000000000000000000ac4f4a203ef1e53b899908d699f5bb51608ad2ef4f69",
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 950200,
    rangeReplayStartedAt: "2026-07-11T20:13:36.954Z",
    startedAt: "2026-07-11T17:14:57.622Z",
    status: "complete",
    transactionNormalization: "canonical-raw-tx-only",
    verifierBinding,
  };
  assert.equal(canonicalRebuildTrustState(common, "livenet"), "invalid");
  const complete = {
    ...common,
    completedAt: "2026-07-18T20:30:00.000Z",
    incbRangeReplayVerification: verification,
    rangeReplayFromHeight: 958383,
  };
  assert.equal(canonicalRebuildTrustState(complete, "livenet"), "complete");
  for (const [label, changedVerification] of [
    ["witness hash", { witnessSetHash: "7".repeat(64) }],
    ["witness count", { witnessCount: verifierBinding.witnessCount + 1 }],
    [
      "witness through checkpoint",
      { witnessedThroughBlock: verifierBinding.witnessedThroughBlock - 1 },
    ],
    ["preserve consumption count", { consumedPreserveCount: 0 }],
    ["missing preserve proof", { preservedWitnesses: [] }],
    [
      "corrupt preserve proof",
      {
        preservedWitnesses: [
          { ...preservedWitnesses[0], mintPayloadHash: "not-a-hash" },
        ],
      },
    ],
    ["rederive consumption count", { rederivedWitnessCount: 0 }],
    ["missing rederive proof", { rederivedWitnesses: [] }],
    [
      "corrupt rederive provenance",
      {
        rederivedWitnesses: [
          {
            ...rederivedWitnesses[0],
            snapshotFingerprint: "not-a-hash",
          },
        ],
      },
    ],
  ]) {
    assert.equal(
      canonicalPwtRangeReplayVerificationIsValid(
        {
          ...complete,
          incbRangeReplayVerification: {
            ...verification,
            ...changedVerification,
          },
        },
        "livenet",
      ),
      false,
      `${label} mismatch escaped API completion validation`,
    );
  }

  const blockHash = "f".repeat(64);
  let rebuild = common;
  const status = {
    indexedThroughBlock: 958600,
    readModels: {
      confirmedIds: { count: 1 },
      confirmedTransfers: { count: 1 },
    },
    scan: { blockHash, complete: true },
    worker: {
      lastSuccessAt: new Date().toISOString(),
      ok: true,
    },
  };
  const loadCanonicalPublicReadGate = isolatedFunction(
    API_PATH,
    "loadCanonicalPublicReadGate",
    {
      PROOF_INDEX_HEALTH_MAX_AGE_MS: 60_000,
      PROOF_INDEX_REQUIRED: true,
      bitcoinRpc: async () => ({
        ok: true,
        result: { bestblockhash: blockHash, blocks: 958600 },
      }),
      canonicalRebuildTrustState,
      proofIndexCanonicalStateMetaPayload: async () => ({
        fault: null,
        rebuild,
      }),
      proofIndexOperationalStatusPayload: async () => status,
      summarySnapshotCoversCanonicalReadModels: () => true,
    },
  );
  assert.equal(
    (await loadCanonicalPublicReadGate("livenet")).available,
    false,
  );
  rebuild = complete;
  assert.equal(
    (await loadCanonicalPublicReadGate("livenet")).available,
    true,
  );
});

check("an invalid Inception H-1 barrier cannot begin the next block", async () => {
  const checkpointHash = "6".repeat(64);
  const blockHash = "7".repeat(64);
  let verified = 0;
  let transactions = 0;
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      BLOCK_SCAN_MAX_BLOCKS: 0,
      BLOCK_SCAN_MAX_TXIDS: Number.POSITIVE_INFINITY,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD: false,
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      STORE_CANONICAL_SUMMARY_SNAPSHOT: true,
      assertCanonicalProtocolTransactionContent:
        acceptCanonicalProtocolTransactionContent,
      assertCanonicalBlockEnvelope: () => {},
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 101;
        if (method === "getblockhash") {
          return params[0] === 100 ? checkpointHash : blockHash;
        }
        if (method === "getblock") {
          return {
            hash: blockHash,
            height: 101,
            nTx: 1,
            previousblockhash: checkpointHash,
            time: 1_700_000_101,
            tx: [{ txid: "8".repeat(64) }],
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      latestBlockScanCheckpoint: async () => ({
        blockHash: checkpointHash,
        height: 100,
      }),
      canonicalBlockScanVerificationFailureRecord:
        canonicalVerificationFailureRecord,
      proofIndexerMetaValue: async () => null,
      protocolMessagesContainInceptionBond: () => true,
      protocolMessagesFromTx: () => [
        { prefix: "pwm1:", text: "pwm1:m:incb", voutIndex: 1 },
      ],
      preparedProtocolItemsForTx: async () => {
        verified += 1;
        return [];
      },
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {},
      storeCanonicalSummarySnapshot: async () => ({
        indexedThroughBlock: 99,
        indexedThroughBlockHash: "9".repeat(64),
      }),
    },
  );
  await rejection(
    backfillBlockScanSource(
      {
        async query() {
          transactions += 1;
          return { rows: [] };
        },
      },
      { label: "block-scan" },
    ),
    (error) => /H-1 summary barrier failed/u.test(error.message),
    "The scanner advanced past an invalid H-1 summary barrier",
  );
  assert.equal(verified, 0);
  assert.equal(transactions, 2);
});

check("a verifier error cannot begin or advance a block checkpoint", async () => {
  const databaseCalls = [];
  const checkpointCalls = [];
  const txid = "5".repeat(64);
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      BLOCK_SCAN_MAX_BLOCKS: 0,
      BLOCK_SCAN_MAX_TXIDS: Number.POSITIVE_INFINITY,
      CANONICAL_REBUILD: false,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      canonicalRebuildCheckpointValue: () => null,
      proofIndexerMetaValue: async () => null,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 101;
        if (method === "getblockhash") return params[0] === 100 ? "h100" : "h101";
        if (method === "getblock") {
          return {
            hash: "h101",
            height: 101,
            nTx: 1,
            previousblockhash: "h100",
            time: 1_700_000_000,
            tx: [{ txid }],
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      latestBlockScanCheckpoint: async () => ({ blockHash: "h100", height: 100 }),
      assertCanonicalProtocolTransactionContent:
        acceptCanonicalProtocolTransactionContent,
      assertCanonicalBlockEnvelope: () => {},
      assertHydratedProtocolTransaction: () => {},
      canonicalBlockScanVerificationFailureRecord:
        canonicalVerificationFailureRecord,
      persistPreparedProtocolItems: async () => ({ indexed: 1, skipped: 0 }),
      removeVolatileWorkMintDecisionEvents: async () => 0,
      preparedProtocolItemsForTx: async () => {
        throw new Error("canonical verifier is stale");
      },
      protocolMessagesFromTx: () => ["pwid1:r2:fixture"],
      storeBlockScanSnapshot: async (client, payload) => {
        checkpointCalls.push(payload);
      },
      transactionWithInputPrevouts: async (tx) => tx,
      verifyCanonicalIncbPwtRangeReplayProjection: async () => null,
    },
  );
  const client = {
    async query(sql) {
      databaseCalls.push(String(sql).trim());
      return { rows: [] };
    },
  };
  await rejection(
    backfillBlockScanSource(client, { label: "block-scan" }),
    (error) => /canonical verifier is stale/u.test(error.message),
    "The block scan should fail closed on an unresolved canonical verifier",
  );
  assert.deepEqual(databaseCalls, []);
  assert.deepEqual(checkpointCalls, []);
});

check("the protocol tx target defers a later block but never splits one", async () => {
  async function runFixture(protocolCounts) {
    const persistedBlocks = [];
    let verified = 0;
    const tipHeight = 100 + protocolCounts.length;
    const blockFor = (height) => {
      const count = protocolCounts[height - 101] ?? 0;
      return {
        hash: `h${height}`,
        height,
        nTx: count,
        previousblockhash: `h${height - 1}`,
        time: 1_700_000_000 + height,
        tx: Array.from({ length: count }, (_, index) => ({
          txid: (BigInt(height) * 1_000_000n + BigInt(index) + 1n)
            .toString(16)
            .padStart(64, "0"),
        })),
      };
    };
    const backfillBlockScanSource = isolatedFunction(
      BACKFILL_PATH,
      "backfillBlockScanSource",
      {
        BITCOIN_RPC_URL: "http://core.invalid",
        BLOCK_SCAN_MAX_BLOCKS: 0,
        BLOCK_SCAN_MAX_TXIDS: 250,
        CANONICAL_FAULT_META_KEY: "canonical:fault",
        CANONICAL_REBUILD: false,
        CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
        NETWORK: "livenet",
        assertCanonicalProtocolTransactionContent:
          acceptCanonicalProtocolTransactionContent,
        assertCanonicalBlockEnvelope: () => {},
        assertHydratedProtocolTransaction: () => {},
        bitcoinRpc: async (method, params = []) => {
          if (method === "getblockcount") return tipHeight;
          if (method === "getblockhash") return `h${params[0]}`;
          if (method === "getblock") {
            const height = Number(String(params[0]).slice(1));
            return blockFor(height);
          }
          throw new Error(`unexpected RPC method ${method}`);
        },
        canonicalRebuildCheckpointValue: () => null,
        canonicalBlockScanVerificationFailureRecord:
          canonicalVerificationFailureRecord,
        latestBlockScanCheckpoint: async () => ({ blockHash: "h100", height: 100 }),
        persistCanonicalBlock: async (_client, _block, height) => {
          persistedBlocks.push(height);
        },
        persistCanonicalRawTransaction: async () => {},
        persistPreparedProtocolItems: async () => ({ indexed: 0, skipped: 0 }),
        removeVolatileWorkMintDecisionEvents: async () => 0,
        preparedProtocolItemsForTx: async () => {
          verified += 1;
          return [];
        },
        proofIndexerMetaValue: async () => null,
        protocolMessagesFromTx: () => ["pwid1:r2:fixture"],
        rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {},
        storeBlockScanSnapshot: async () => {},
        transactionWithInputPrevouts: async (tx) => tx,
        verifyCanonicalIncbPwtRangeReplayProjection: async () => null,
      },
    );
    const client = {
      async query() {
        return { rows: [] };
      },
    };
    const result = await backfillBlockScanSource(client, { label: "block-scan" });
    return { persistedBlocks, result, verified };
  }

  const deferred = await runFixture([249, 10]);
  assert.deepEqual(deferred.persistedBlocks, [101]);
  assert.equal(deferred.verified, 249);
  assert.equal(deferred.result.indexedThroughBlock, 101);
  assert.equal(deferred.result.stopReason, "protocol-txid-limit");

  const denseFirstBlock = await runFixture([251]);
  assert.deepEqual(denseFirstBlock.persistedBlocks, [101]);
  assert.equal(denseFirstBlock.verified, 251);
  assert.equal(denseFirstBlock.result.indexedThroughBlock, 101);
  assert.equal(denseFirstBlock.result.complete, true);
});

check("an explicitly requested participant repair aborts when its row is absent", async () => {
  const txid = "6".repeat(64);
  let coreReads = 0;
  const queries = [];
  const repairConfirmedWorkTransferParticipants = isolatedFunction(
    BACKFILL_PATH,
    "repairConfirmedWorkTransferParticipants",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      NETWORK: "livenet",
      REPAIR_WORK_PARTICIPANTS: true,
      REPAIR_WORK_PARTICIPANTS_LIMIT: 10,
      REPAIR_WORK_PARTICIPANTS_TXIDS: [txid],
      WORK_TOKEN_ID: "work-token",
      rawTransactionFromCore: async () => {
        coreReads += 1;
        return null;
      },
    },
  );
  const client = {
    async query(sql, params) {
      queries.push({ params, sql: String(sql).trim() });
      return { rows: [] };
    },
  };
  await rejection(
    repairConfirmedWorkTransferParticipants(client),
    (error) => error.message.includes(txid),
    "A missing explicit txid must be reported instead of a successful zero-row repair",
  );
  assert.equal(coreReads, 0);
  assert.deepEqual(Array.from(queries[0].params[2]), [txid]);
  assert.equal(queries.some((call) => call.sql === "BEGIN"), false);
});

check("Carbonz valid transfer participant repair preserves the legacy event key", () => {
  const txid = "6ed13a1783d612dc1c1f692d2bd6e60c55f3bf88ead9352112a78931ea18852f";
  const tokenId = "b".repeat(64);
  const stableEventKey = isolatedFunction(BACKFILL_PATH, "stableEventKey");
  const input = {
    kind: "token-transfer",
    protocol: "pwt1",
    sourceLabel: "token-transfers",
    txid,
  };
  const legacyKey = stableEventKey({
    ...input,
    item: { tokenId },
  });
  const repairedKey = stableEventKey({
    ...input,
    item: { protocolVout: 4, tokenId, vout: 4 },
  });
  assert.equal(repairedKey, legacyKey);
  assert.equal(legacyKey, `pwt1:token-transfer:${txid}:${tokenId}`);
});

check("only true same-kind duplicates receive stable ordinals", () => {
  const txid = "f".repeat(64);
  const tokenId = "a".repeat(64);
  const disambiguateDuplicateProtocolItems = isolatedFunction(
    BACKFILL_PATH,
    "disambiguateDuplicateProtocolItems",
  );
  const stableEventKey = isolatedFunction(BACKFILL_PATH, "stableEventKey");
  const duplicates = disambiguateDuplicateProtocolItems([
    { kind: "token-transfer", protocol: "pwt1", protocolVout: 4, tokenId, txid },
    { kind: "token-transfer", protocol: "pwt1", protocolVout: 9, tokenId, txid },
    { kind: "token-transfer", protocol: "pwt1", protocolVout: 12, tokenId, txid },
    { kind: "token-mint", protocol: "pwt1", protocolVout: 13, tokenId, txid },
  ]);
  assert.equal(duplicates[0].eventKeyVout, undefined);
  assert.equal(duplicates[1].eventKeyVout, 1);
  assert.equal(duplicates[2].eventKeyVout, 2);
  assert.equal(duplicates[3].eventKeyVout, undefined);
  const keys = duplicates.slice(0, 3).map((item) =>
    stableEventKey({
      item,
      kind: item.kind,
      protocol: item.protocol,
      sourceLabel: "token-transfers",
      txid,
    }),
  );
  assert.equal(new Set(keys).size, 3);
});

check("pwm1 outputs aggregate once while staged protocols stay unscanned", () => {
  let baseCalls = 0;
  const decodedBase64UrlBytes = isolatedFunction(
    BACKFILL_PATH,
    "decodedBase64UrlBytes",
    { Buffer },
  );
  const aggregatePwmProtocolItem = isolatedFunction(
    BACKFILL_PATH,
    "aggregatePwmProtocolItem",
    {
      Buffer,
      INFINITY_BOND_KIND: "infinity-bond",
      INFINITY_BOND_MEMO: "powb",
      MAIL_ATTACHMENT_MAX_BYTES: 60_000,
      bondTagForMemo: (value) =>
        value === "powb" ? { kind: "infinity-bond" } : null,
      baseProtocolItem: (_tx, _message, kind) => {
        baseCalls += 1;
        return { amountSats: "1000", kind, protocol: "pwm1", txid: "1".repeat(64) };
      },
      createHash: (algorithm) =>
        // The fixture attachment is not exercised in this aggregate value check.
        ({ update: () => ({ digest: () => algorithm }) }),
      decodeBase64UrlText: (value) =>
        Buffer.from(String(value), "base64url").toString("utf8"),
      decodedBase64UrlBytes,
    },
  );
  const messages = [
    { prefix: "pwm1:", text: "pwm1:s:SGVsbG8", voutIndex: 2 },
    { prefix: "pwm1:", text: "pwm1:m:proof", voutIndex: 3 },
    { prefix: "pwm1:", text: "pwm1:m:s", voutIndex: 4 },
  ];
  const item = aggregatePwmProtocolItem({ txid: "1".repeat(64) }, messages);
  assert.equal(baseCalls, 1);
  assert.equal(item.kind, "mail");
  assert.equal(item.memo, "proofs");
  assert.equal(item.subject, "Hello");
  assert.equal(item.amountSats, "1000");
  assert.equal(
    item.dataBytes,
    messages.reduce((total, message) => total + Buffer.byteLength(message.text), 0),
  );
  const rawProtocolItemsForTx = isolatedFunction(
    BACKFILL_PATH,
    "rawProtocolItemsForTx",
    {
      aggregatePwmProtocolItem,
      canonicalBondMintItemsFromMailItem: () => [],
      protocolItemsFromTx: (_tx, message) =>
        message?.prefix === "pwr1:"
          ? [{ kind: "rush-mint", protocol: "pwr1" }]
          : assert.fail("unexpected protocol reached the raw block-scan parser"),
    },
  );
  const aggregated = rawProtocolItemsForTx(
    { txid: "1".repeat(64) },
    [
      ...messages,
      { prefix: "pwr1:", text: "pwr1:m:rush", voutIndex: 5 },
      { prefix: "pwc1:", text: "pwc1:profile:staged", voutIndex: 6 },
    ],
  );
  assert.equal(aggregated.length, 2);
  assert.equal(aggregated[0].amountSats, "1000");
  assert.equal(aggregated[1].kind, "rush-mint");

  const parseRush = isolatedFunction(BACKFILL_PATH, "protocolItemsFromTx", {
    RUSH_MINT_PAYLOAD: "pwr1:m:rush",
    RUSH_MINT_PRICE_SATS: 1_000n,
    RUSH_REGISTRY_ADDRESS: "bc1rushregistry",
    baseProtocolItem: () => ({
      confirmed: true,
      kind: "rush-mint",
      recipients: [{ address: "bc1rushregistry", amountSats: "1000" }],
      txid: "4".repeat(64),
    }),
    invalidProtocolItem: (item, reason) => ({
      ...item,
      kind: `${item.kind}-invalid`,
      reason,
      valid: false,
    }),
    senderAddressFromTx: () => "bc1rushminter",
  });
  const validRush = parseRush(
    { txid: "4".repeat(64) },
    { prefix: "pwr1:", text: "pwr1:m:rush", voutIndex: 2 },
  );
  assert.equal(validRush[0].kind, "rush-mint");
  assert.equal(validRush[0].valid, true);
  assert.equal(validRush[0].validationMode, "canonical-ordered-rush-index");
  const invalidRush = parseRush(
    { txid: "5".repeat(64) },
    { prefix: "pwr1:", text: "pwr1:m:unknown", voutIndex: 2 },
  );
  assert.equal(invalidRush[0].kind, "rush-mint-invalid");
  assert.equal(invalidRush[0].valid, false);

  const protocolMessagesFromTx = isolatedFunction(
    BACKFILL_PATH,
    "protocolMessagesFromTx",
    {
      PROTOCOL_PREFIXES: ["pwm1:", "pwid1:", "pwr1:", "pwt1:"],
      opReturnTextFromVout: (vout) => vout.text,
    },
  );
  const scanned = protocolMessagesFromTx({
    vout: [
      { text: "pwr1:m:rush" },
      { text: "pwc1:profile:staged" },
      { text: "pwm1:m:hello" },
    ],
  });
  assert.deepEqual(Array.from(scanned, (message) => message.prefix), [
    "pwr1:",
    "pwm1:",
  ]);
});

check("legacy pwid1:r registrations retain plain IDs and projection fields", () => {
  const protocolItemsFromTx = isolatedFunction(
    BACKFILL_PATH,
    "protocolItemsFromTx",
    {
      baseProtocolItem: (_tx, _message, kind) => ({
        kind,
        protocol: "pwid1",
        txid: "a".repeat(64),
      }),
      decodeBase64UrlText: (value) =>
        Buffer.from(String(value), "base64url").toString("utf8"),
      normalizedPowId: (value) => String(value ?? "").trim().toLowerCase(),
    },
  );
  const [registration] = protocolItemsFromTx(
    { txid: "a".repeat(64) },
    {
      prefix: "pwid1:",
      text: "pwid1:r:bitcoin:1owner:1receiver",
    },
  );

  assert.equal(registration.kind, "id-register");
  assert.equal(registration.id, "bitcoin");
  assert.equal(registration.ownerAddress, "1owner");
  assert.equal(registration.receiveAddress, "1receiver");
});

check("canonical PWM aggregation classifies reply, file, and bond once", () => {
  const bytes = Buffer.from("x");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const decodedBase64UrlBytes = isolatedFunction(
    BACKFILL_PATH,
    "decodedBase64UrlBytes",
    { Buffer },
  );
  const aggregatePwmProtocolItem = isolatedFunction(
    BACKFILL_PATH,
    "aggregatePwmProtocolItem",
    {
      Buffer,
      INFINITY_BOND_KIND: "infinity-bond",
      INFINITY_BOND_MEMO: "powb",
      MAIL_ATTACHMENT_MAX_BYTES: 60_000,
      bondTagForMemo: (value) =>
        value === "powb" ? { kind: "infinity-bond" } : null,
      baseProtocolItem: (_tx, _message, kind) => ({
        amountSats: "546",
        kind,
        protocol: "pwm1",
        txid: "2".repeat(64),
      }),
      createHash,
      decodeBase64UrlText: (value) =>
        Buffer.from(String(value), "base64url").toString("utf8"),
      decodedBase64UrlBytes,
    },
  );
  const reply = aggregatePwmProtocolItem({}, [
    { prefix: "pwm1:", text: `pwm1:r:${"3".repeat(64)}`, voutIndex: 1 },
    { prefix: "pwm1:", text: "pwm1:m:reply", voutIndex: 2 },
  ]);
  const file = aggregatePwmProtocolItem({}, [
    {
      prefix: "pwm1:",
      text: `pwm1:a:dGV4dC9wbGFpbg:eC50eHQ:1:${sha256}:0/1:${bytes.toString("base64url")}`,
      voutIndex: 1,
    },
  ]);
  const bond = aggregatePwmProtocolItem({}, [
    { prefix: "pwm1:", text: "pwm1:m:po", voutIndex: 1 },
    { prefix: "pwm1:", text: "pwm1:m:wb", voutIndex: 2 },
  ]);
  assert.equal(reply.kind, "reply");
  assert.equal(file.kind, "file");
  assert.equal(file.attachment.sha256, sha256);
  assert.equal(bond.kind, "infinity-bond");
  assert.equal(bond.amountSats, "546");
});

check("canonical mail recipients become indexed participants", () => {
  const participantsForItem = isolatedFunction(
    BACKFILL_PATH,
    "participantsForItem",
  );
  const sender = "bc1sender";
  const recipient = "bc1recipient";
  const participants = participantsForItem({
    recipients: [{ address: recipient }],
    senderAddress: sender,
  });
  assert.ok(
    participants.some(
      (participant) =>
        participant.address === recipient && participant.role === "recipient",
    ),
  );
  assert.ok(
    participants.some(
      (participant) =>
        participant.address === sender && participant.role === "sender",
    ),
  );
});

check("address-mail exposes exact canonical WORK siblings and fails closed on ambiguity", () => {
  const workTokenId = "4".repeat(64);
  const sameMailPaymentAddress = isolatedFunction(
    READER_PATH,
    "sameMailPaymentAddress",
    {
      normalizedAddress: (value) => String(value ?? "").trim(),
    },
  );
  const canonicalMailAttachedCreditsFromRow = isolatedFunction(
    READER_PATH,
    "canonicalMailAttachedCreditsFromRow",
    {
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_MAX_SUPPLY_ATOMS: "2100000000000000",
      WORK_TOKEN_TICKER: "WORK",
      canonicalEventIdentityDetails: (item) =>
        Number.isSafeInteger(Number(item?.eventId))
          ? { eventId: Number(item.eventId) }
          : {},
      formatWorkAtoms: (value) => {
        const atoms = String(value).padStart(9, "0");
        const whole = atoms.slice(0, -8) || "0";
        const fraction = atoms.slice(-8).replace(/0+$/u, "");
        return fraction ? `${whole}.${fraction}` : whole;
      },
      normalizeWorkAtoms: (value) => {
        const text = String(value ?? "").trim();
        if (!/^[1-9]\d*$/u.test(text)) {
          throw new Error("invalid atoms");
        }
        return text;
      },
      normalizedAddress: (value) => String(value ?? "").trim(),
      objectRecord: (value) => value ?? {},
      positiveNumber: (value) => Number(value) || 0,
      sameMailPaymentAddress,
      withWorkPrecisionMetadata: (value) => ({
        ...value,
        amountStorageModel: "work-atoms-v1",
        decimals: 8,
        unitScale: "100000000",
      }),
    },
  );
  const target = "bc1qtarget";
  const other = "bc1qother";
  const baseRow = {
    attached_credit_events: [
      {
        amount: "stale-float-must-not-win",
        amountAtoms: "123456789",
        eventId: 12,
        protocolVout: 3,
        recipientAddress: target.toUpperCase(),
        ticker: "WORK",
        tokenId: workTokenId,
      },
      {
        amountAtoms: "2099999999999999",
        eventId: 13,
        protocolVout: 4,
        recipientAddress: other,
        tokenId: workTokenId,
      },
      {
        amount: "999",
        protocolVout: 5,
        recipientAddress: target,
        tokenId: workTokenId,
      },
      {
        amountAtoms: "100000000",
        protocolVout: 6,
        recipientAddress: target,
        tokenId: "5".repeat(64),
      },
    ],
    status: "confirmed",
  };
  const credits = canonicalMailAttachedCreditsFromRow(baseRow, [target, other]);
  assert.equal(credits.length, 2);
  assert.equal(credits[0].amount, "1.23456789");
  assert.equal(credits[0].amountAtoms, "123456789");
  assert.equal(credits[1].amountAtoms, "2099999999999999");
  assert.equal(
    canonicalMailAttachedCreditsFromRow(
      { ...baseRow, status: "pending" },
      [target, other],
    ).length,
    0,
  );
  assert.equal(
    canonicalMailAttachedCreditsFromRow(
      {
        ...baseRow,
        attached_credit_events: [
          baseRow.attached_credit_events[0],
          {
            ...baseRow.attached_credit_events[0],
            amountAtoms: "123456790",
          },
        ],
      },
      [target],
    ).length,
    0,
    "conflicting canonical rows for one protocol output must fail closed",
  );

  const mailRecipientRowsFromSource = isolatedFunction(
    READER_PATH,
    "mailRecipientRowsFromSource",
    {
      normalizedAddress: (value) => String(value ?? "").trim(),
      positiveNumber: (value) => Number(value) || 0,
    },
  );
  const exactMailRecipientRows = isolatedFunction(
    READER_PATH,
    "exactMailRecipientRows",
    {
      mailRecipientRowsFromSource,
      normalizedAddress: (value) => String(value ?? "").trim(),
      normalizedAddressKey: (value) => String(value ?? "").trim().toLowerCase(),
      positiveNumber: (value) => Number(value) || 0,
      recipientRows: () => [],
    },
  );
  assert.equal(
    JSON.stringify(exactMailRecipientRows(
      {
        recipients: [
          { address: target, amountSats: 111, vout: 0 },
          { address: other, amountSats: 222, vout: 1 },
        ],
      },
      {},
      [target, other],
      333,
    ).map(({ address, amountSats }) => ({ address, amountSats }))),
    JSON.stringify([
      { address: target, amountSats: 111 },
      { address: other, amountSats: 222 },
    ]),
  );
  assert.equal(
    exactMailRecipientRows(
      { recipients: [{ address: target, amountSats: 999 }] },
      {
        recipients: [
          { address: target, amountSats: 111, vout: 0 },
          { address: other, amountSats: 222, vout: 1 },
        ],
      },
      [target, other],
      333,
    ).length,
    2,
    "a no-vout projection must not duplicate an exact raw recipient output",
  );
  assert.equal(
    exactMailRecipientRows(
      { recipients: [{ address: target, amountSats: 111 }] },
      { recipients: [{ address: target, amountSats: 999 }] },
      [target],
      999,
    )[0].amountSats,
    111,
    "canonical no-vout recipients must beat stale raw metadata",
  );

  const addressMailSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexAddressMailPayload",
  );
  assert.match(
    addressMailSource,
    /candidate_mail_transactions[\s\S]*canonical_work_attachments[\s\S]*JOIN candidate_mail_transactions/u,
  );
  assert.match(
    addressMailSource,
    /transfer_event\.block_height = transfer_transaction\.block_height[\s\S]*transfer_block\.canonical = true/u,
  );
  assert.match(
    addressMailSource,
    /lower\(COALESCE\(transfer_event\.payload->>'blockHash', ''\)\)[\s\S]*transfer_transaction\.block_hash/u,
  );
  assert.doesNotMatch(addressMailSource, /fallbackRecipientAddresses/u);
});

check("raw mail WORK parsing accepts recipient-matched send and send2 only", () => {
  const workTokenId = "4".repeat(64);
  const registryAddress = "1workregistry";
  const target = "bc1qtarget";
  const other = "bc1qother";
  const attachedWorkCreditsFromVout = isolatedFunction(
    API_PATH,
    "attachedWorkCreditsFromVout",
    {
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: registryAddress,
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_TICKER: "WORK",
      decodedProtocolMessages: (outputs) =>
        outputs.map((output) => output?.message).filter(Boolean),
      parseTokenPayload: (message) => {
        const parts = String(message).split(":");
        if (
          parts[0] !== "pwt1" ||
          !["send", "send2"].includes(parts[1]) ||
          parts.length !== 5
        ) {
          return null;
        }
        const amountAtoms =
          parts[1] === "send2"
            ? parts[3]
            : `${parts[3]}00000000`;
        return /^[1-9]\d*$/u.test(amountAtoms)
          ? {
              amountAtoms,
              amountVersion: parts[1],
              kind: "send",
              recipientAddress: parts[4],
              tokenId: parts[2],
            }
          : null;
      },
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
      tokenLedgerAmountFields: (_tokenId, amountAtoms) => ({
        amount: String(amountAtoms),
        amountAtoms: String(amountAtoms),
      }),
      tokenLedgerAmountFromRecord: (_tokenId, record) => record.amountAtoms,
      tokenPaymentAmountBeforeProtocol: (outputs, address) =>
        outputs.reduce(
          (total, output) =>
            output?.address === address
              ? total + Number(output?.value ?? 0)
              : total,
          0,
        ),
    },
  );
  const recipients = [
    { address: target },
    { address: other },
  ];
  const credits = attachedWorkCreditsFromVout(
    [
      { address: registryAddress, value: 1_092 },
      { message: `pwt1:send:${workTokenId}:7:${target}` },
      { message: `pwt1:send2:${workTokenId}:2099999999999999:${other}` },
      { message: `pwt1:send2:${workTokenId}:1:bc1qnotrecipient` },
    ],
    recipients,
    "livenet",
  );
  assert.equal(credits.length, 2);
  assert.equal(credits[0].amountAtoms, "700000000");
  assert.equal(credits[1].amountAtoms, "2099999999999999");
  assert.equal(
    attachedWorkCreditsFromVout(
      [
        { address: registryAddress, value: 545 },
        { message: `pwt1:send2:${workTokenId}:1:${target}` },
      ],
      recipients,
      "livenet",
    ).length,
    0,
  );
});

check("pending mail attachment repair is bounded, recipient-scoped, and fail-open", async () => {
  const txid = "6".repeat(64);
  const target = "bc1qtarget";
  const pendingCredit = {
    amount: "0.00000001",
    amountAtoms: "1",
    recipientAddress: target,
    ticker: "WORK",
    tokenId: "4".repeat(64),
  };
  const mailMessageNeedsPendingWorkRepair = isolatedFunction(
    API_PATH,
    "mailMessageNeedsPendingWorkRepair",
  );
  const repairPendingMailWorkAttachments = isolatedFunction(
    API_PATH,
    "repairPendingMailWorkAttachments",
    {
      MAIL_PENDING_WORK_REPAIR_MAX_TXS: 1,
      MAIL_PENDING_WORK_REPAIR_WAIT_MS: 25,
      errorSummary: (error) => String(error?.message ?? error),
      fetchPendingMailTransactionFromFirstParty: async (requestedTxid) => ({
        confirmed: false,
        txid: requestedTxid,
      }),
      inboxMessagesFromTransactions: (_txs, address) => [
        {
          attachedCredits: [
            { ...pendingCredit, recipientAddress: address },
          ],
          txid,
        },
      ],
      mailMessageNeedsPendingWorkRepair,
      mergedSourceLabel: (left, right) => `${left}+${right}`,
      payloadWithFallbackAfterMs: async (promise) => promise,
      sentMessagesFromTransactions: () => [
        { attachedCredits: [pendingCredit], txid },
      ],
      transactionConfirmed: (tx) => tx.confirmed === true,
      transactionTxid: (tx) => tx.txid,
    },
  );
  const repaired = await repairPendingMailWorkAttachments(
    {
      inboxMessages: [{ confirmed: false, txid }],
      sentMessages: [{ status: "pending", txid }],
      source: "proof-indexer-mail",
      stats: {},
    },
    target,
    "livenet",
  );
  assert.equal(repaired.inboxMessages[0].attachedCredits[0].amountAtoms, "1");
  assert.equal(repaired.sentMessages[0].attachedCredits[0].amountAtoms, "1");
  assert.equal(repaired.stats.repairedPendingWorkAttachments, 2);
  assert.match(repaired.source, /pending-work-attachment-repair/u);

  const confirmedRepair = isolatedFunction(
    API_PATH,
    "repairPendingMailWorkAttachments",
    {
      MAIL_PENDING_WORK_REPAIR_MAX_TXS: 1,
      MAIL_PENDING_WORK_REPAIR_WAIT_MS: 25,
      errorSummary: (error) => String(error?.message ?? error),
      fetchPendingMailTransactionFromFirstParty: async (requestedTxid) => ({
        confirmed: true,
        txid: requestedTxid,
      }),
      inboxMessagesFromTransactions: () => [],
      mailMessageNeedsPendingWorkRepair,
      mergedSourceLabel: (left, right) => `${left}+${right}`,
      payloadWithFallbackAfterMs: async (promise) => promise,
      sentMessagesFromTransactions: () => [],
      transactionConfirmed: (tx) => tx.confirmed === true,
      transactionTxid: (tx) => tx.txid,
    },
  );
  const unchanged = await confirmedRepair(
    {
      inboxMessages: [{ confirmed: false, txid }],
      sentMessages: [],
      source: "proof-indexer-mail",
    },
    target,
    "livenet",
  );
  assert.equal(unchanged.inboxMessages[0].attachedCredits, undefined);

  const reconcileMailPayloadStatuses = isolatedFunction(
    API_PATH,
    "reconcileMailPayloadStatuses",
    {
      mailStats: () => ({}),
      txStatusPayload: async () => ({
        indexedAt: "2026-07-18T00:00:02.000Z",
        status: "confirmed",
      }),
    },
  );
  const raced = await reconcileMailPayloadStatuses(
    {
      inboxMessages: [
        { attachedCredits: [pendingCredit], confirmed: false, txid },
      ],
      sentMessages: [
        { attachedCredits: [pendingCredit], status: "pending", txid },
      ],
    },
    "livenet",
  );
  assert.equal(raced.inboxMessages[0].confirmed, true);
  assert.equal(raced.inboxMessages[0].attachedCredits, undefined);
  assert.equal(raced.sentMessages[0].status, "confirmed");
  assert.equal(raced.sentMessages[0].attachedCredits, undefined);
});

check("mail merges preserve canonical attachments without promoting raw confirmed claims", () => {
  const mergeMailMessageLists = isolatedFunction(
    API_PATH,
    "mergeMailMessageLists",
    {
      mailMessageRichness: (message) =>
        [
          message?.memo,
          ...(Array.isArray(message?.attachedCredits)
            ? message.attachedCredits
            : []),
        ].filter(Boolean).length,
    },
  );
  const txid = "7".repeat(64);
  const rawClaim = [{ amountAtoms: "999", tokenId: "4".repeat(64) }];
  const [failClosed] = mergeMailMessageLists(
    [{ confirmed: true, createdAt: "2026-07-18T00:00:00.000Z", txid }],
    [
      {
        attachedCredits: rawClaim,
        confirmed: true,
        createdAt: "2026-07-18T00:00:01.000Z",
        memo: "raw richer row",
        txid,
      },
    ],
  );
  assert.equal(failClosed.attachedCredits, undefined);

  const canonicalCredits = [{ amountAtoms: "1", tokenId: "4".repeat(64) }];
  const [preserved] = mergeMailMessageLists(
    [
      {
        attachedCredits: canonicalCredits,
        confirmed: true,
        createdAt: "2026-07-18T00:00:00.000Z",
        txid,
      },
    ],
    [
      {
        confirmed: false,
        createdAt: "2026-07-18T00:00:01.000Z",
        memo: "pending richer row",
        txid,
      },
    ],
  );
  assert.equal(preserved.attachedCredits[0].amountAtoms, "1");
  assert.equal(preserved.confirmed, true);

  const eventOverlaySource = topLevelFunctionSource(
    API_PATH,
    "mailPayloadWithIndexedEventOverlay",
  );
  assert.match(
    eventOverlaySource,
    /eventItems[\s\S]*\.map\(\(item\) => \(\{ \.\.\.item, attachedCredits: undefined \}\)\)/u,
    "confirmed event overlays must not promote embedded WORK claims",
  );
});

check("wallet mail projection recognizes canonical senderAddress as sent activity", () => {
  const sender = "bc1psender";
  const recipient = "bc1precipient";
  const addressMailRowPayloads = isolatedFunction(
    READER_PATH,
    "addressMailRowPayloads",
    {
      canonicalEventPayload: (value) => value ?? {},
      canonicalMailAttachedCreditsFromRow: () => [],
      dateIso: (value) => new Date(value).toISOString(),
      exactMailRecipientRows: (_payload, _raw, addresses, amountSats) =>
        addresses.map((address) => ({ address, amountSats, display: address })),
      knownMailAddress: (value) => String(value ?? "").trim(),
      mailMemoFromEvent: (_row, payload) => String(payload?.memo ?? ""),
      mailParticipantRecordsFromRow: () => [
        { address: sender, role: "sender" },
        { address: recipient, role: "recipient" },
      ],
      mailParticipantsFromRow: () => [sender, recipient],
      mailSubjectFromEvent: () => "",
      normalizeEventPayload: (value) => value ?? {},
      normalizedAddress: (value) => String(value ?? "").trim(),
      normalizedAddressKey: (value) => String(value ?? "").trim().toLowerCase(),
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : {},
      positiveNumber: (value) => Number(value) || 0,
      recipientRows: (addresses, amountSats) =>
        addresses.map((address) => ({ address, amountSats, display: address })),
      recipientSummary: (recipients) => recipients[0]?.display ?? "Unknown",
      rawTransactionItemPayload: () => ({}),
      sameMailPaymentAddress: (left, right) =>
        String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase(),
    },
  );

  const projected = addressMailRowPayloads(
    {
      event_time: "2026-07-11T00:00:00.000Z",
      kind: "mail",
      payload: {
        amountSats: 546,
        memo: "hello",
        recipients: [{ address: recipient }],
        senderAddress: sender,
      },
      status: "confirmed",
      txid: "a".repeat(64),
    },
    sender,
    "livenet",
  );

  assert.equal(projected.length, 1);
  assert.equal(projected[0].folder, "sent");
  assert.equal(projected[0].message.from, sender);
  assert.equal(projected[0].message.to, recipient);
});

check("reserved bond credits reject generic create and mint supply", () => {
  const txid = "a".repeat(64);
  const powbTokenId = "b".repeat(64);
  const incbTokenId = "c".repeat(64);
  const bondTags = [
    { ticker: "POWB", tokenId: powbTokenId },
    { ticker: "INCB", tokenId: incbTokenId },
  ];
  const canonicalBondMintProjectionStructure = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintProjectionStructure",
    { BOND_TAGS: bondTags },
  );
  const canonicalBondMintProjection = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintProjection",
    {
      BOND_TAGS: bondTags,
      canonicalBondMintProjectionStructure,
      canonicalIncbIssuanceMintProjection: () => true,
    },
  );
  const reservedBondCreditViolationReason = isolatedFunction(
    BACKFILL_PATH,
    "reservedBondCreditViolationReason",
    {
      BOND_TOKEN_IDS: new Set(bondTags.map((tag) => tag.tokenId)),
      BOND_TOKEN_TICKERS: new Set(bondTags.map((tag) => tag.ticker)),
      canonicalBondMintProjection,
      canonicalBondMintProjectionStructure,
    },
  );

  assert.match(
    reservedBondCreditViolationReason({
      kind: "token-create",
      ticker: "POWB",
      tokenId: txid,
    }),
    /reserved synthetic bond credits/u,
  );
  assert.match(
    reservedBondCreditViolationReason({
      kind: "token-mint",
      protocol: "pwt1",
      tokenId: incbTokenId,
      txid,
    }),
    /generic pwt1 create and mint/u,
  );
  assert.equal(
    reservedBondCreditViolationReason({
      kind: "token-transfer",
      tokenId: powbTokenId,
      txid,
    }),
    "",
    "POWB/INCB transfers and sale-ticket markets remain permitted",
  );
  assert.equal(
    reservedBondCreditViolationReason({
      amount: "100",
      amountSats: 0,
      confirmed: true,
      kind: "token-mint",
      minterAddress: "bc1pbondholder",
      protocol: "pwt1",
      sourceBondTxid: txid,
      ticker: "POWB",
      tokenId: powbTokenId,
      txid,
      validationMode: "canonical-powb-bond-projection",
    }),
    "",
    "a canonical PWM bond projection must remain the only POWB mint lane",
  );

  assert.match(
    topLevelFunctionSource(BACKFILL_PATH, "canonicalRecoveryItemsForTx"),
    /reservedBondCreditViolationReason\(normalizedItem\)/u,
  );
  assert.match(
    topLevelFunctionSource(BACKFILL_PATH, "persistPreparedProtocolItems"),
    /protocolIntegrityItemForPersistence/u,
  );
});

check("malformed canonical INCB projections are never mislabeled generic", async () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const txid = "f".repeat(64);
  const bondTags = [{ ticker: "INCB", tokenId }];
  const canonicalBondMintProjectionStructure = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintProjectionStructure",
    { BOND_TAGS: bondTags },
  );
  const canonicalBondMintProjectionInvalidReason = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintProjectionInvalidReason",
    {
      INCB_TOKEN_ID: tokenId,
      canonicalBondMintProjectionStructure,
      incbIssuanceMetadataInvalidReason: () =>
        "missing exact H-1 Q8 issuance metadata",
    },
  );
  const reservedBondCreditViolationReason = isolatedFunction(
    BACKFILL_PATH,
    "reservedBondCreditViolationReason",
    {
      BOND_TOKEN_IDS: new Set([tokenId]),
      BOND_TOKEN_TICKERS: new Set(["INCB"]),
      canonicalBondMintProjectionStructure,
    },
  );
  const protocolIntegrityItemForPersistence = isolatedFunction(
    BACKFILL_PATH,
    "protocolIntegrityItemForPersistence",
    {
      canonicalBondMintProjectionInvalidReason,
      reservedBondCreditViolationReason,
      tokenMintDefinitionOrderInvalidReason: async () => "",
      tokenProtocolIntegrityInvalidItem: (
        item,
        reason,
        reasonCode,
      ) => ({
        ...item,
        attemptedKind: item.kind,
        kind: "token-event-invalid",
        reason,
        reasonCode,
        valid: false,
      }),
    },
  );
  const malformedProjection = {
    amount: "1000",
    amountSats: 0,
    confirmed: true,
    kind: "token-mint",
    minterAddress: "bond-recipient",
    protocol: "pwt1",
    sourceBondTxid: txid,
    ticker: "INCB",
    tokenId,
    txid,
    validationMode: "canonical-incb-bond-projection",
  };

  assert.equal(reservedBondCreditViolationReason(malformedProjection), "");
  const persisted = await protocolIntegrityItemForPersistence(
    { query: async () => ({ rows: [] }) },
    malformedProjection,
  );
  assert.equal(persisted.kind, "token-event-invalid");
  assert.equal(
    persisted.reasonCode,
    "canonical-incb-bond-projection-invalid",
  );
  assert.match(persisted.reason, /Canonical INCB bond projection rejected/u);
  assert.doesNotMatch(persisted.reason, /generic pwt1/iu);
  assert.match(
    reservedBondCreditViolationReason({
      amount: "1000",
      amountSats: 0,
      confirmed: true,
      kind: "token-mint",
      minterAddress: "bond-recipient",
      protocol: "pwt1",
      ticker: "INCB",
      tokenId,
      txid,
    }),
    /generic pwt1 create and mint/u,
  );
});

check("atomic WORK send2 attachments dispatch both Inception verifier scopes", () => {
  const txid = "a".repeat(64);
  const workTokenId = "b".repeat(64);
  const incbTokenId = "c".repeat(64);
  const tokenScopesForProtocolMessage = isolatedFunction(
    BACKFILL_PATH,
    "tokenScopesForProtocolMessage",
    {
      decodeBase64UrlJson: () => null,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
    },
  );
  const recoveryEndpointSpecs = isolatedFunction(
    BACKFILL_PATH,
    "recoveryEndpointSpecs",
    {
      INCB_TOKEN_ID: incbTokenId,
      INCEPTION_BOND_MEMO: "incb",
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
      tokenScopesForProtocolMessage,
    },
  );
  const messages = [
    { prefix: "pwm1:", text: "pwm1:m:incb" },
    {
      prefix: "pwt1:",
      text: `pwt1:send2:${workTokenId}:398800000000000:holder`,
    },
  ];
  const specs = messages.flatMap((message) =>
    recoveryEndpointSpecs(txid, message),
  );
  assert.deepEqual(
    specs.map((spec) => spec.params.asset),
    [incbTokenId, workTokenId],
  );
  assert.equal(
    JSON.stringify(tokenScopesForProtocolMessage(txid, messages[1].text)),
    JSON.stringify([workTokenId]),
  );
});

check("backfill persistence accepts exact-Q8 INCB issuance above float precision", () => {
  const txid =
    "e1ecc4b4be95a6771801d516380eb20a0f8e3c0b2fb1045599a57d5a68fa1698";
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const blockHash =
    "000000000000000000021fb7871138c76c262471fe3b178e8829d62cbf167ae8";
  const canonicalIncbIssuanceQ8Projection = isolatedFunction(
    BACKFILL_PATH,
    "canonicalIncbIssuanceQ8Projection",
    {
      VALUE_Q8_SCALE,
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_UNIT_SCALE,
      canonicalIntegerText: (value, { positive = false } = {}) => {
        const text = String(value ?? "").trim();
        return (positive ? /^[1-9]\d*$/u : /^\d+$/u).test(text) ? text : "";
      },
      canonicalWorkAtomsText,
    },
  );
  const incbIssuanceMetadataInvalidReason = isolatedFunction(
    BACKFILL_PATH,
    "incbIssuanceMetadataInvalidReason",
    {
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_VALUE_SNAPSHOT_MODEL: "canonical-summary-h-minus-one-v1",
      VALUE_Q8_SCALE,
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_UNIT_SCALE,
      canonicalIntegerText: (value, { positive = false } = {}) => {
        const text = String(value ?? "").trim();
        return (positive ? /^[1-9]\d*$/u : /^\d+$/u).test(text) ? text : "";
      },
      canonicalIncbIssuanceQ8Projection,
      canonicalWorkAtomsText,
      decimalValueToQ8,
      formatWorkAtoms,
      q8ToNumber,
    },
  );
  const canonicalIncbIssuanceMintProjection = (item) =>
    String(item?.tokenId ?? "").trim().toLowerCase() === tokenId &&
    !incbIssuanceMetadataInvalidReason(item);
  const canonicalBondMintProjectionStructure = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintProjectionStructure",
    { BOND_TAGS: [{ ticker: "INCB", tokenId }] },
  );
  const canonicalBondMintProjection = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintProjection",
    {
      BOND_TAGS: [{ ticker: "INCB", tokenId }],
      canonicalBondMintProjectionStructure,
      canonicalIncbIssuanceMintProjection,
    },
  );
  const reservedBondCreditViolationReason = isolatedFunction(
    BACKFILL_PATH,
    "reservedBondCreditViolationReason",
    {
      BOND_TOKEN_IDS: new Set([tokenId]),
      BOND_TOKEN_TICKERS: new Set(["INCB"]),
      canonicalBondMintProjection,
      canonicalBondMintProjectionStructure,
    },
  );
  const mint = {
    amount: "116657103344743",
    amountSats: 0,
    attachedWorkAmount: 3_988_000,
    attachedWorkAmountAtoms: "398800000000000",
    attachedWorkIssuanceUnits: "116657103344197",
    attachedWorkLiveFloorAtSendQ8: "2925203193184481",
    attachedWorkLiveFloorAtSendSats: 29_252_031.931844823,
    attachedWorkLiveValueAtSendQ8: "11665710334419713836190",
    attachedWorkLiveValueAtSendSats: 116_657_103_344_197.14,
    blockHash,
    blockHeight: 958432,
    blockIndex: 1653,
    bondRecipientAddress: "1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT",
    bondRecipientAmountSats: "546",
    bondRecipientVout: 0,
    confirmed: true,
    confirmedIssuanceUnits: "116657103344743",
    directProofIssuanceUnits: "546",
    issuanceAccountingModel: "canonical-pre-bond-live-network-value-v2",
    issuanceAmount: "116657103344743",
    issuanceCheckpointBlockHash: blockHash,
    issuanceCheckpointBlockHeight: 958432,
    issuanceCheckpointBlockIndex: 1653,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustQ8: "13836190",
    issuanceDustSats: 0.1383619,
    issuanceFloorSats: 1.000000000000001,
    issuanceNetworkValueQ8: "11665710334474313836190",
    issuanceNetworkValueSats: 116_657_103_344_743.14,
    issuanceUnitSats: 1,
    issuanceValuationFixedAtSend: true,
    issuanceValueSnapshotBlockHash:
      "0000000000000000000108134886191cca47cb3db5df607c7c5aa9a02e957b3f",
    issuanceValueSnapshotBlockHeight: 958431,
    issuanceValueSnapshotCanonicalSummaryHash:
      "5b44677748e3a68e1ea376f8a2226277d9a53907279aff8ac4d2ba56524c6cfb",
    issuanceValueSnapshotGeneratedAt: "2026-07-17T21:12:25.822Z",
    issuanceValueSnapshotId: "ff4bf2984490c79d326866e3",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueQ8: "61429267056874120000000",
    issuanceValueSnapshotWorkNetworkValueSats: 614_292_670_568_741.2,
    kind: "token-mint",
    minterAddress: "1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT",
    paidSats: 546,
    proofPaymentSats: 546,
    protocol: "pwt1",
    sourceBondTxid: txid,
    ticker: "INCB",
    tokenId,
    txid,
    validationMode: "canonical-incb-bond-projection",
  };

  assert.equal(incbIssuanceMetadataInvalidReason(mint), "");
  assert.equal(canonicalBondMintProjection(mint), true);
  assert.equal(reservedBondCreditViolationReason(mint), "");
  const hugeSnapshotNetworkValueQ8 = 10n ** 321n + 12_345_678n;
  const hugeIssuanceNetworkValueQ8 =
    hugeSnapshotNetworkValueQ8 + 546n * VALUE_Q8_SCALE;
  const hugeConfirmedIssuanceUnits =
    hugeIssuanceNetworkValueQ8 / VALUE_Q8_SCALE;
  const hugeAttachedIssuanceUnits =
    hugeSnapshotNetworkValueQ8 / VALUE_Q8_SCALE;
  const hugeAttachedFloorQ8 =
    hugeSnapshotNetworkValueQ8 / BigInt(WORK_TOKEN_MAX_SUPPLY);
  const hugeMint = {
    ...mint,
    amount: hugeConfirmedIssuanceUnits.toString(),
    attachedWorkAmount: "21000000",
    attachedWorkAmountAtoms: WORK_TOKEN_MAX_SUPPLY_ATOMS.toString(),
    attachedWorkIssuanceUnits: hugeAttachedIssuanceUnits.toString(),
    attachedWorkLiveFloorAtSendQ8: hugeAttachedFloorQ8.toString(),
    attachedWorkLiveFloorAtSendSats:
      decimalTextFromQ8(hugeAttachedFloorQ8),
    attachedWorkLiveValueAtSendQ8: hugeSnapshotNetworkValueQ8.toString(),
    attachedWorkLiveValueAtSendSats:
      decimalTextFromQ8(hugeSnapshotNetworkValueQ8),
    confirmedIssuanceUnits: hugeConfirmedIssuanceUnits.toString(),
    issuanceAmount: hugeConfirmedIssuanceUnits.toString(),
    issuanceDustQ8: (
      hugeIssuanceNetworkValueQ8 % VALUE_Q8_SCALE
    ).toString(),
    issuanceDustSats: decimalTextFromQ8(
      hugeIssuanceNetworkValueQ8 % VALUE_Q8_SCALE,
    ),
    issuanceFloorSats: decimalTextFromQ8(
      hugeIssuanceNetworkValueQ8 / hugeConfirmedIssuanceUnits,
    ),
    issuanceNetworkValueQ8: hugeIssuanceNetworkValueQ8.toString(),
    issuanceNetworkValueSats: decimalTextFromQ8(
      hugeIssuanceNetworkValueQ8,
    ),
    issuanceValueSnapshotWorkNetworkValueQ8:
      hugeSnapshotNetworkValueQ8.toString(),
    issuanceValueSnapshotWorkNetworkValueSats:
      decimalTextFromQ8(hugeSnapshotNetworkValueQ8),
  };
  assert.equal(Number.isFinite(Number(hugeMint.issuanceNetworkValueSats)), false);
  assert.equal(
    incbIssuanceMetadataInvalidReason(hugeMint),
    "",
    "exact Q8 issuance must not inherit the finite range of its Number compatibility aliases",
  );
  assert.equal(canonicalBondMintProjection(hugeMint), true);
  assert.match(
    incbIssuanceMetadataInvalidReason({
      ...hugeMint,
      issuanceNetworkValueQ8: (
        hugeIssuanceNetworkValueQ8 + 1n
      ).toString(),
    }),
    /does not conserve value/u,
    "huge exact issuance still fails closed when Q8 conservation disagrees",
  );
  assert.match(
    incbIssuanceMetadataInvalidReason({
      ...hugeMint,
      issuanceValueSnapshotWorkNetworkValueQ8: "1e321",
    }),
    /incomplete or noncanonical/u,
    "huge exact issuance still requires canonical integer Q8 provenance",
  );
  const rawProtocolItemMatchesCanonical = isolatedFunction(
    BACKFILL_PATH,
    "rawProtocolItemMatchesCanonical",
    {
      INCB_TOKEN_ID: tokenId,
      canonicalBondMintProjectionStructure,
      isWorkTokenId: () => false,
      workAmountAtomsFromRecord,
    },
  );
  const rawSeedMint = { ...mint, amount: "546" };
  assert.equal(canonicalBondMintProjectionStructure(rawSeedMint), true);
  assert.equal(
    rawProtocolItemMatchesCanonical(rawSeedMint, mint, "token-mint"),
    true,
    "the exact issuance projection must pair with its raw direct-proof seed mint",
  );
  assert.match(
    incbIssuanceMetadataInvalidReason({
      ...mint,
      issuanceNetworkValueQ8: "11665710334474313836191",
    }),
    /does not conserve value/u,
  );
  assert.match(
    incbIssuanceMetadataInvalidReason({
      ...mint,
      attachedWorkLiveFloorAtSendQ8: "2925203193184482",
    }),
    /checkpoint is missing or inconsistent/u,
  );
  const {
    issuanceDustQ8: _missingIssuanceDustQ8,
    ...incompleteAtomicMint
  } = mint;
  assert.match(
    incbIssuanceMetadataInvalidReason(incompleteAtomicMint),
    /incomplete or noncanonical/u,
  );
});

check("ordered credit verifier seeds both bond families without generic minting", () => {
  const workTokenId = "1".repeat(64);
  const powbTokenId = "2".repeat(64);
  const incbTokenId = "3".repeat(64);
  const tokenCreationIsAllowed = isolatedFunction(
    API_PATH,
    "tokenCreationIsAllowed",
    {
      BLOCKED_TOKEN_CREATOR_ADDRESSES: new Set(),
      BOND_TOKEN_IDS: new Set([powbTokenId, incbTokenId]),
      WORK_TOKEN_ID: workTokenId,
      normalizeTokenCreatorAddress: (value) => String(value ?? "").toLowerCase(),
      tokenTickerIsReserved: (value) => ["WORK", "POWB", "INCB"].includes(value),
    },
  );
  assert.equal(
    tokenCreationIsAllowed({ ticker: "POWB", tokenId: powbTokenId }),
    false,
  );
  assert.equal(
    tokenCreationIsAllowed({ ticker: "INCB", tokenId: incbTokenId }),
    false,
  );
  assert.equal(
    tokenCreationIsAllowed({ ticker: "WORK", tokenId: workTokenId }),
    true,
  );

  const tokenDefinitionPrecedesTransaction = isolatedFunction(
    API_PATH,
    "tokenDefinitionPrecedesTransaction",
    {
      BOND_TOKEN_IDS: new Set([powbTokenId, incbTokenId]),
      WORK_TOKEN_ID: workTokenId,
      transactionBlockHeight: (tx) => tx.blockHeight,
      transactionBlockIndex: (tx) => tx.blockIndex,
      transactionConfirmed: (tx) => tx.confirmed === true,
    },
  );
  const definition = {
    blockHeight: 100,
    blockIndex: 2,
    confirmed: true,
    tokenId: "4".repeat(64),
  };
  assert.equal(
    tokenDefinitionPrecedesTransaction(definition, {
      blockHeight: 100,
      blockIndex: 3,
      confirmed: true,
    }),
    true,
  );
  assert.equal(
    tokenDefinitionPrecedesTransaction(definition, {
      blockHeight: 100,
      blockIndex: 1,
      confirmed: true,
    }),
    false,
  );
  assert.equal(
    tokenDefinitionPrecedesTransaction(
      { ...definition, confirmed: false },
      { blockHeight: 101, blockIndex: 0, confirmed: true },
    ),
    false,
  );

  const tokenReplaySource = topLevelFunctionSource(
    API_PATH,
    "tokenStateFromTransactions",
  );
  assert.match(
    tokenReplaySource,
    /parsed\.kind === "mint"[\s\S]*BOND_TOKEN_IDS\.has\(parsed\.tokenId\)[\s\S]*tokenDefinitionPrecedesTransaction/u,
  );
  const confirmedVerifierSource = topLevelFunctionSource(
    API_PATH,
    "completeTokenVerifierState",
  );
  assert.match(confirmedVerifierSource, /for \(const config of BOND_TOKEN_CONFIGS\)/u);
  assert.match(
    confirmedVerifierSource,
    /canonicalBondTokenDefinition\(config, network, registryAddress\)/u,
  );
  assert.match(
    confirmedVerifierSource,
    /bondMintsFromActivity\([\s\S]*registryAddress,[\s\S]*network,[\s\S]*config/u,
  );
  assert.match(
    topLevelFunctionSource(
      API_PATH,
      "loadCanonicalVerifierContextFromCheckpoint",
    ),
    /priorInvalidEvents:[\s\S]*prior\?\.invalidEvents/u,
  );
  assert.match(
    confirmedVerifierSource,
    /inceptionVerifierBondActivity\([\s\S]*context\.priorInvalidEvents[\s\S]*bondMintsFromActivity\([\s\S]*verifierBondActivity[\s\S]*canonicalInceptionIssuanceOptions\(network, verifierBondActivity/u,
  );
});

check("canonical bond mint replay unlocks only later INCB mutations", () => {
  const tokenId = INCB_TOKEN_ID;
  const registryAddress = "registry";
  const alice = "alice";
  const bob = "bob";
  const buyer = "buyer";
  const carol = "carol";
  const dave = "dave";
  const erin = "erin";
  const txid = (digit) => String(digit).repeat(64);
  const blockHash = "f".repeat(64);
  const transactionTxid = (tx) => tx.txid;
  const transactionConfirmed = (tx) => tx.status.confirmed === true;
  const transactionBlockHeight = (tx) => tx.status.block_height;
  const transactionBlockIndex = (tx) => tx.status.block_index;
  const tokenTransactionTime = (tx) => tx.status.block_time * 1000;
  const tokenProtocolSortedTransactions = isolatedFunction(
    API_PATH,
    "tokenProtocolSortedTransactions",
    {
      transactionBlockHeight,
      transactionBlockIndex,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const canonicalTokenReplayOrdinal = isolatedFunction(
    API_PATH,
    "canonicalTokenReplayOrdinal",
  );
  const tokenReplayEntriesForRegistry = isolatedFunction(
    API_PATH,
    "tokenReplayEntriesForRegistry",
    {
      canonicalTokenReplayOrdinal,
      tokenProtocolSortedTransactions,
      tokenTransactionTime,
      transactionBlockHeight,
      transactionBlockIndex,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const insufficientTokenBalanceInvalidEvent = isolatedFunction(
    API_PATH,
    "insufficientTokenBalanceInvalidEvent",
  );
  const tokenStateFromTransactions = isolatedFunction(
    API_PATH,
    "tokenStateFromTransactions",
    {
      BOND_TOKEN_IDS: new Set([tokenId]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      canonicalEventIdentityDetails: () => ({}),
      canonicalInceptionMintMetadata: () => ({}),
      decodedProtocolMessages: (outputs) =>
        outputs.flatMap((output) => output?.message ? [output.message] : []),
      inputAddresses: (vin) => vin.map((input) => input.address),
      insufficientTokenBalanceInvalidEvent,
      isValidBitcoinAddress: (address) => Boolean(address),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      parseTokenPayload: (message) => message,
      paymentAmountFromSnapshots: () => 10_000,
      paymentOutputsBeforeTokenProtocol: () => [],
      proofProtocolDataBytesForVout: () => 0,
      spendsTokenListingAnchor: (spent, listing) =>
        spent.includes(listing.listingId),
      spentOutpoints: (vin) => vin.flatMap((input) => input.spends ?? []),
      tokenDefinitionPrecedesTransaction: () => true,
      tokenDefinitionsFromTransactions: () => ({
        creationSats: 0,
        tokens: [],
      }),
      tokenListingAnchorIsPresent: () => true,
      tokenListingAnchorSpendMatchesAuthorization: () => true,
      tokenListingIsExpired: () => false,
      tokenMatchesScope: (token, scope) =>
        !scope || token.tokenId === scope || token.ticker.toLowerCase() === scope,
      tokenPaymentAmountBeforeProtocol: (outputs) => outputs.length * 546,
      tokenReplayEntriesForRegistry,
      tokenSaleAuthorizationTermsMatch: () => true,
      tokenSaleAuthorizationUsesSaleTicketAnchor: () => true,
      tokenSellerPaymentRequiredSats: () => 100,
      tokenTransactionTime,
      transactionBlockHash: () => blockHash,
      transactionBlockHeight,
      transactionBlockIndex,
      transactionConfirmed,
      transactionMinerFeeSats: () => 10,
      transactionTxid,
    },
  );
  const transaction = (id, blockIndex, actor, message, options = {}) => ({
    txid: txid(id),
    status: {
      block_hash: blockHash,
      block_height: 100,
      block_index: blockIndex,
      // Deliberately regress timestamps: replay must still follow position.
      block_time: 2_000 - blockIndex,
      confirmed: true,
    },
    vin: [{ address: actor, spends: options.spends ?? [] }],
    vout: message ? [{ message }] : [],
  });
  const transactionMessages = (id, blockIndex, actor, messages) => ({
    txid: txid(id),
    status: {
      block_hash: blockHash,
      block_height: 100,
      block_index: blockIndex,
      block_time: 2_000 - blockIndex,
      confirmed: true,
    },
    vin: [{ address: actor, spends: [] }],
    vout: messages.map((message) => ({ message })),
  });
  const send = (amount, recipientAddress) => ({
    amount,
    kind: "send",
    recipientAddress,
    tokenId,
  });
  const listingTxid = txid(5);
  const listingAuthorization = {
    amount: 300,
    buyerAddress: "",
    priceSats: 100,
    registryAddress,
    sellerAddress: alice,
    ticker: "INCB",
    tokenId,
  };
  const transactions = [
    transaction(1, 1, alice, send(600, bob)),
    transaction(2, 2, alice, send(1, bob)),
    transaction(3, 3, alice, send(600, bob)),
    transaction(5, 4, alice, {
      kind: "list",
      saleAuthorization: listingAuthorization,
    }),
    transaction(6, 5, buyer, {
      buyerAddress: buyer,
      kind: "buy",
      listingId: listingTxid,
    }, { spends: [listingTxid] }),
    transaction(7, 6, carol, send(100, erin)),
    transaction(8, 7, carol, null),
    transaction(9, 8, carol, send(100, erin)),
    transactionMessages(10, 9, carol, [
      send(100, erin),
      send(1_000, bob),
    ]),
  ];
  const seedMints = [
    {
      amount: 1_000,
      blockHeight: 100,
      blockIndex: 2,
      confirmed: true,
      createdAt: "2030-01-01T00:00:00.000Z",
      minterAddress: alice,
      recipientOrdinal: 0,
      tokenId,
      txid: txid(2),
    },
    {
      amount: 700,
      blockHeight: 100,
      blockIndex: 2,
      confirmed: true,
      createdAt: "2030-01-01T00:00:00.000Z",
      minterAddress: dave,
      recipientOrdinal: 1,
      tokenId,
      txid: txid(2),
    },
    {
      amount: 500,
      blockHeight: 100,
      blockIndex: 7,
      confirmed: true,
      createdAt: "1990-01-01T00:00:00.000Z",
      minterAddress: carol,
      recipientOrdinal: 0,
      tokenId,
      txid: txid(8),
    },
  ];
  const state = tokenStateFromTransactions(
    [],
    new Map([[registryAddress, transactions]]),
    "index",
    "livenet",
    tokenId,
    [{
      maxSupply: null,
      registryAddress,
      ticker: "INCB",
      tokenId,
      uncapped: true,
    }],
    seedMints,
  );

  assert.equal(state.confirmedSupply, "2200");
  assert.equal(state.transfers.length, 3, "only post-bond sends are valid");
  assert.equal(state.sales.length, 1, "post-bond list and sale must settle");
  assert.equal(state.invalidEvents.length, 4);
  const partialTxRejection = state.invalidEvents.find(
    (event) => event.txid === txid(10),
  );
  assert.equal(partialTxRejection.reasonCode, "insufficient-spendable-balance");
  assert.equal(partialTxRejection.protocolVout, 1);
  assert.equal(partialTxRejection.amount, "1000");
  assert.deepEqual(
    Object.fromEntries(state.holders.map((holder) => [holder.address, holder.balance])),
    {
      alice: "100",
      bob: "600",
      buyer: "300",
      carol: "300",
      dave: "700",
      erin: "200",
    },
  );
  assert.equal(
    state.holders
      .reduce((total, holder) => total + BigInt(holder.balance), 0n)
      .toString(),
    String(state.confirmedSupply),
    "multi-recipient issuance and dependent mutations must conserve supply",
  );

  const unsafeTransferAmount = "9007199254740993";
  const unsafeSeedAmount = "9007199254742993";
  const unsafeListingTxid = txid(3);
  const unsafeState = tokenStateFromTransactions(
    [],
    new Map([[registryAddress, [
      transaction(1, 1, alice, null),
      transaction(2, 2, alice, send(unsafeTransferAmount, bob)),
      transaction(3, 3, bob, {
        kind: "list",
        saleAuthorization: {
          ...listingAuthorization,
          amount: unsafeTransferAmount,
          sellerAddress: bob,
        },
      }),
      transaction(4, 4, buyer, {
        buyerAddress: buyer,
        kind: "buy",
        listingId: unsafeListingTxid,
      }, { spends: [unsafeListingTxid] }),
    ]]]),
    "index",
    "livenet",
    tokenId,
    [{
      maxSupply: null,
      registryAddress,
      ticker: "INCB",
      tokenId,
      uncapped: true,
    }],
    [{
      amount: unsafeSeedAmount,
      blockHeight: 100,
      blockIndex: 1,
      confirmed: true,
      createdAt: "2030-01-01T00:00:00.000Z",
      minterAddress: alice,
      recipientOrdinal: 0,
      tokenId,
      txid: txid(1),
    }],
  );
  assert.equal(unsafeState.confirmedSupply, unsafeSeedAmount);
  assert.equal(unsafeState.transfers[0]?.amount, unsafeTransferAmount);
  assert.equal(
    unsafeState.sales[0]?.amount,
    unsafeTransferAmount,
    JSON.stringify({
      holders: unsafeState.holders,
      invalidEvents: unsafeState.invalidEvents,
      listings: unsafeState.listings,
      sales: unsafeState.sales,
      transfers: unsafeState.transfers,
    }),
  );
  assert.deepEqual(
    Object.fromEntries(
      unsafeState.holders.map((holder) => [holder.address, holder.balance]),
    ),
    { alice: "2000", buyer: unsafeTransferAmount },
  );
  assert.equal(
    unsafeState.holders.reduce(
      (total, holder) => total + BigInt(holder.balance),
      0n,
    ),
    BigInt(unsafeState.confirmedSupply),
  );

  const issuanceModel = "canonical-pre-bond-live-network-value-v2";
  const canonicalInceptionMintMetadata = (mint) =>
    mint?.issuanceAccountingModel === issuanceModel
      ? { issuanceAccountingModel: issuanceModel }
      : {};
  const inceptionSeedMintReplaySignature = isolatedFunction(
    API_PATH,
    "inceptionSeedMintReplaySignature",
    { JSON, canonicalInceptionMintMetadata },
  );
  let expansionCalls = 0;
  const strictReplay = isolatedFunction(
    API_PATH,
    "tokenStateFromTransactionsWithCanonicalInceptionIssuance",
    {
      INCB_TOKEN_ID: tokenId,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL: issuanceModel,
      WORK_TOKEN_ID: "work",
      currentBlockRejectedInceptionAttachmentDispositions: () => [],
      dedupeActivityItems: (items) => items,
      emptyTokenState: () => ({ tokens: [] }),
      inceptionMintsWithLiveIssuance: (mints, activity, ledger, options) => {
        expansionCalls += 1;
        assert.equal(activity[0].attachedCredits[0].amount, 2);
        assert.equal(ledger.workTokenState.transfers[0].amount, 2);
        return mints.map((mint) =>
          mint.issuanceAccountingModel === issuanceModel ||
          !options.legacyBondTxids?.has(mint.txid)
            ? mint
            : {
                ...mint,
                amount: 1_000,
                issuanceAccountingModel: issuanceModel,
              },
        );
      },
      inceptionSeedMintReplaySignature,
      isInceptionBondActivityItem: (item) => item?.kind === "inception-bond",
      isTokenActivityItem: () => false,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      scopedTokenPayloadFromState: (state) => state,
      tokenActivityItemsFromState: () => [],
      tokenStateFromTransactions,
      tokenStateWithInceptionInvalidDispositions: (state) => state,
      tokenStateWithScopedTokenOverride: (_base, scoped) => scoped,
    },
  );
  const legacyBondSeed = {
    amount: 546,
    blockHeight: 100,
    blockIndex: 2,
    confirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    minterAddress: alice,
    tokenId,
    txid: txid(2),
  };
  const strictState = strictReplay(
    [],
    new Map([[registryAddress, [
      transaction(2, 2, alice, null),
      transaction(3, 3, alice, send(600, bob)),
    ]]]),
    "index",
    "livenet",
    tokenId,
    [{
      maxSupply: Number.MAX_SAFE_INTEGER,
      registryAddress,
      ticker: "INCB",
      tokenId,
      uncapped: true,
    }],
    [legacyBondSeed],
    [{
      attachedCredits: [{ amount: 2, tokenId: "work" }],
      blockHeight: 100,
      blockIndex: 2,
      confirmed: true,
      kind: "inception-bond",
      txid: txid(2),
    }],
    {
      activity: [],
      tokenState: { tokens: [] },
      workTokenState: { transfers: [{ amount: 2, txid: txid(2) }] },
    },
  );
  assert.ok(expansionCalls >= 2);
  assert.equal(strictState.confirmedSupply, "1000");
  assert.equal(strictState.transfers.length, 1);
  assert.deepEqual(
    Object.fromEntries(
      strictState.holders.map((holder) => [holder.address, holder.balance]),
    ),
    { alice: "400", bob: "600" },
  );
});

check("scoped bond supply ignores empty definition aliases", () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const exactSupply = "111357589873271";
  const tokenSummarySupplyMetricValue = isolatedFunction(
    API_PATH,
    "tokenSummarySupplyMetricValue",
    {
      canonicalIntegerText,
      isBondTokenId: (value) => value === tokenId,
      tokenSummaryMetricValue: (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : undefined;
      },
    },
  );
  assert.equal(tokenSummarySupplyMetricValue(tokenId, undefined), undefined);
  assert.equal(tokenSummarySupplyMetricValue(tokenId, ""), undefined);
  assert.equal(
    tokenSummarySupplyMetricValue(tokenId, exactSupply),
    exactSupply,
  );
  const scopedTokenPayloadFromState = isolatedFunction(
    API_PATH,
    "scopedTokenPayloadFromState",
    {
      isBondTokenId: (value) => value === tokenId,
      isWorkTokenId: () => false,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      tokenAggregateSummaries: () =>
        new Map([[tokenId, {
          confirmedSupply: exactSupply,
          pendingSupply: "0",
        }]]),
      tokenMatchesScope: (token, scope) => token?.tokenId === scope,
      tokenPayloadWithScopedHolderIdentity: (payload) => payload,
      tokenSummarySupplyMetricValue: (_tokenId, value) =>
        canonicalIntegerText(value, { allowZero: true }),
    },
  );
  const scoped = scopedTokenPayloadFromState(
    {
      closedListings: [],
      holders: [],
      invalidEvents: [],
      listings: [],
      mints: [],
      sales: [],
      tokens: [{
        confirmed: true,
        confirmedSupply: "",
        pendingSupply: "",
        tokenId,
      }],
      transfers: [],
    },
    tokenId,
  );

  assert.equal(scoped.confirmedSupply, exactSupply);
  assert.equal(scoped.pendingSupply, "0");
});

check("same-block Inception checkpoints share one H-1 source but bind per bond", async () => {
  const blockHash = "a".repeat(64);
  const previousBlockHash = "b".repeat(64);
  const snapshot = { snapshotId: "shared-h-minus-one" };
  const bonds = [11, 22, 33].map((blockIndex, index) => ({
    blockHash,
    blockHeight: 958_087,
    blockIndex,
    confirmed: true,
    kind: "inception-bond",
    txid: String(index + 1).repeat(64),
  }));
  const cache = new Map();
  let sourceLoads = 0;
  let summaryReads = 0;
  const canonicalInceptionIssuanceOptions = isolatedFunction(
    API_PATH,
    "canonicalInceptionIssuanceOptions",
    {
      cachedInternalVerifierState: async (key, loader) => {
        if (!cache.has(key)) {
          sourceLoads += 1;
          cache.set(key, Promise.resolve().then(loader));
        }
        return cache.get(key);
      },
      canonicalInceptionPreviousBlockHash: async () => previousBlockHash,
      canonicalInceptionValueSnapshotCheckpoint: (value, bond) => ({
        blockHash: bond.blockHash,
        blockHeight: bond.blockHeight,
        blockIndex: bond.blockIndex,
        valueSnapshotBlockHash: previousBlockHash,
        valueSnapshotId: value.snapshotId,
      }),
      inceptionValueSnapshotUnavailableError: () =>
        new Error("unexpected unavailable H-1 snapshot"),
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      proofIndexCanonicalSummaryLedgerPayload: async () => {
        summaryReads += 1;
        return snapshot;
      },
    },
  );

  const options = await canonicalInceptionIssuanceOptions(
    "livenet",
    bonds,
    {
      previousBlockHashByBlockHash: new Map([[blockHash, previousBlockHash]]),
    },
  );
  const checkpoints = bonds.map((bond) => options.preBondCheckpoint(bond));

  assert.equal(sourceLoads, 1);
  assert.equal(summaryReads, 1);
  assert.deepEqual(
    checkpoints.map((checkpoint) => checkpoint.blockIndex),
    bonds.map((bond) => bond.blockIndex),
  );
  assert.ok(
    checkpoints.every(
      (checkpoint) =>
        checkpoint.valueSnapshotBlockHash === previousBlockHash &&
        checkpoint.valueSnapshotId === snapshot.snapshotId,
    ),
  );
});

check("published Inception checkpoints expand all legacy bonds in one replay pass", () => {
  const tokenId = "c".repeat(64);
  const issuanceModel = "canonical-pre-bond-live-network-value-v2";
  const bonds = [1, 2, 3].map((blockIndex) => ({
    blockHeight: 958_087,
    blockIndex,
    confirmed: true,
    kind: "inception-bond",
    txid: String(blockIndex).repeat(64),
  }));
  const seedMints = bonds.map((bond) => ({
    amount: 546,
    blockHeight: bond.blockHeight,
    blockIndex: bond.blockIndex,
    confirmed: true,
    minterAddress: `recipient-${bond.blockIndex}`,
    tokenId,
    txid: bond.txid,
  }));
  let replayCalls = 0;
  const expandedSets = [];
  const replay = isolatedFunction(
    API_PATH,
    "tokenStateFromTransactionsWithCanonicalInceptionIssuance",
    {
      INCB_TOKEN_ID: tokenId,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL: issuanceModel,
      WORK_TOKEN_ID: "work",
      currentBlockRejectedInceptionAttachmentDispositions: () => [],
      dedupeActivityItems: (items) => items,
      inceptionMintsWithLiveIssuance: (mints, _activity, _ledger, options) => {
        const eligible = options.legacyBondTxids ?? new Set();
        expandedSets.push([...eligible]);
        return mints.map((mint) =>
          mint.issuanceAccountingModel === issuanceModel ||
          !eligible.has(mint.txid)
            ? mint
            : { ...mint, amount: 1_000, issuanceAccountingModel: issuanceModel },
        );
      },
      inceptionSeedMintReplaySignature: (mints) =>
        JSON.stringify(
          mints.map((mint) => [
            mint.txid,
            mint.amount,
            mint.issuanceAccountingModel ?? "",
          ]),
        ),
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      isTokenActivityItem: () => false,
      normalizeTokenScope: () => "",
      numericValue: (value) => Number(value) || 0,
      tokenActivityItemsFromState: () => [],
      tokenStateFromTransactions: (
        _indexTxs,
        _registryTxsByAddress,
        _indexAddress,
        _network,
        _tokenScope,
        seedTokens,
        mints,
      ) => {
        replayCalls += 1;
        return {
          closedListings: [],
          holders: [],
          invalidEvents: [],
          listings: [],
          mints,
          sales: [],
          tokens: seedTokens,
          transfers: [],
        };
      },
      tokenStateWithInceptionInvalidDispositions: (state) => state,
    },
  );

  const state = replay(
    [],
    new Map(),
    "index",
    "livenet",
    "",
    [{ tokenId }],
    seedMints,
    bonds,
    { activity: [], workTokenState: { transfers: [] } },
    { preBondCheckpoint: () => ({ snapshotId: "published" }) },
  );

  assert.equal(replayCalls, 2);
  assert.deepEqual(new Set(expandedSets[0]), new Set(bonds.map((bond) => bond.txid)));
  assert.equal(expandedSets[1].length, 0);
  assert.ok(
    state.mints.every(
      (mint) => mint.issuanceAccountingModel === issuanceModel,
    ),
  );
});

check("a malformed current Inception attachment cannot poison later replay", () => {
  const tokenId = "c".repeat(64);
  const workTokenId = "d".repeat(64);
  const invalidTxid = "1".repeat(64);
  const validTxid = "2".repeat(64);
  const laterTransferTxid = "3".repeat(64);
  const nextBlockTxid = "4".repeat(64);
  const issuanceModel = "canonical-pre-bond-live-network-value-v2";
  const currentBlockHeight = 958_500;
  const blockHash = "a".repeat(64);
  const bond = (txid, blockIndex, blockHeight = currentBlockHeight) => ({
    attachedCredits: [
      {
        amount: 10,
        protocolVout: 1,
        recipientAddress: `holder-${txid[0]}`,
        tokenId: workTokenId,
      },
    ],
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    kind: "inception-bond",
    network: "livenet",
    txid,
  });
  const invalidBond = bond(invalidTxid, 1);
  const validBond = bond(validTxid, 2);
  const nextBlockBond = bond(nextBlockTxid, 1, currentBlockHeight + 1);
  const seedMint = (txid, blockIndex, blockHeight = currentBlockHeight) => ({
    amount: 546,
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    minterAddress: `holder-${txid[0]}`,
    network: "livenet",
    sourceKind: "inception-bond",
    tokenId,
    txid,
  });
  const invalidWorkEvent = {
    amount: 10,
    attemptedAmount: 10,
    blockHash,
    blockHeight: currentBlockHeight,
    blockIndex: 1,
    confirmed: true,
    kind: "send",
    protocolVout: 1,
    reasonCode: "insufficient-spendable-balance",
    recipientAddress: undefined,
    tokenId: workTokenId,
    txid: invalidTxid,
  };
  invalidWorkEvent.recipientAddress =
    invalidBond.attachedCredits[0].recipientAddress;
  const inceptionAttachmentMatchesForBond = (_ledger, candidate) =>
    candidate.txid === invalidTxid
      ? { declaredActions: 1, matches: [], unmatchedActions: 1 }
      : { declaredActions: 1, matches: [{}], unmatchedActions: 0 };
  const currentBlockRejectedInceptionAttachmentDispositions = isolatedFunction(
    API_PATH,
    "currentBlockRejectedInceptionAttachmentDispositions",
    {
      INCB_TOKEN_ID: tokenId,
      INCEPTION_BOND_CONFIG: { kind: "inception-bond" },
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL: issuanceModel,
      WORK_TOKEN_ID: workTokenId,
      canonicalEventOrdinal: (value) =>
        Number.isSafeInteger(Number(value)) ? Number(value) : null,
      inceptionAttachmentMatchesForBond,
      isInceptionBondActivityItem: (item) => item?.kind === "inception-bond",
      ledgerTokenStateForScope: (ledger) => ledger?.workTokenState ?? {},
      numericValue: (value) => Number(value) || 0,
      samePaymentAddress: (left, right) => left === right,
      workAtomsBigIntFromRecord: (record) => {
        const amount = Number(record?.amountAtoms ?? record?.amount);
        return Number.isFinite(amount) && amount > 0
          ? BigInt(Math.round(amount * 100_000_000))
          : null;
      },
    },
  );
  const tokenStateWithInceptionInvalidDispositions = isolatedFunction(
    API_PATH,
    "tokenStateWithInceptionInvalidDispositions",
    { INCB_TOKEN_ID: tokenId },
  );
  const inceptionSeedMintReplaySignature = (mints) =>
    JSON.stringify(
      mints.map((mint) => [
        mint.txid,
        mint.amount,
        mint.issuanceAccountingModel ?? "",
      ]),
    );
  const strictReplay = isolatedFunction(
    API_PATH,
    "tokenStateFromTransactionsWithCanonicalInceptionIssuance",
    {
      INCB_TOKEN_ID: tokenId,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL: issuanceModel,
      WORK_TOKEN_ID: workTokenId,
      currentBlockRejectedInceptionAttachmentDispositions,
      dedupeActivityItems: (items) => items,
      inceptionMintsWithLiveIssuance: (mints, _activity, _ledger, options) =>
        mints.map((mint) =>
          options.legacyBondTxids?.has(mint.txid)
            ? { ...mint, amount: 1_000, issuanceAccountingModel: issuanceModel }
            : mint,
        ),
      inceptionSeedMintReplaySignature,
      isInceptionBondActivityItem: (item) => item?.kind === "inception-bond",
      isTokenActivityItem: () => false,
      normalizeTokenScope: () => "",
      numericValue: (value) => Number(value) || 0,
      tokenActivityItemsFromState: () => [],
      tokenStateFromTransactions: (
        _indexTxs,
        _registryTxsByAddress,
        _indexAddress,
        _network,
        _tokenScope,
        seedTokens,
        mints,
      ) => ({
        confirmedSupply: mints.reduce(
          (total, mint) => total + Number(mint.amount ?? 0),
          0,
        ),
        holders: [],
        invalidEvents: [],
        mints,
        tokens: seedTokens,
        transfers: mints.some((mint) => mint.txid === validTxid)
          ? [{ confirmed: true, txid: laterTransferTxid }]
          : [],
      }),
      tokenStateWithInceptionInvalidDispositions,
    },
  );
  const state = strictReplay(
    [],
    new Map(),
    "index",
    "livenet",
    "",
    [{ tokenId }],
    [seedMint(invalidTxid, 1), seedMint(validTxid, 2)],
    [invalidBond, validBond],
    {
      activity: [],
      workTokenState: {
        invalidEvents: [invalidWorkEvent],
        transfers: [],
      },
    },
    {
      allowCurrentBlockInvalidAttachmentDisposition: true,
      currentBlockHash: blockHash,
      currentBlockHeight,
      preBondCheckpoint: () => ({ snapshotId: "h-minus-one" }),
    },
  );

  assert.equal(state.mints.length, 1);
  assert.equal(state.mints[0].txid, validTxid);
  assert.equal(state.mints[0].issuanceAccountingModel, issuanceModel);
  assert.equal(state.transfers[0].txid, laterTransferTxid);
  assert.equal(state.invalidEvents.length, 1);
  assert.equal(state.invalidEvents[0].txid, invalidTxid);
  assert.equal(
    state.invalidEvents[0].reasonCode,
    "invalid-inception-work-attachment",
  );

  const inceptionInvalidOnlyVerifierStateResolved = isolatedFunction(
    API_PATH,
    "inceptionInvalidOnlyVerifierStateResolved",
    {
      INCB_TOKEN_ID: tokenId,
      INCEPTION_BOND_CONFIG: { kind: "inception-bond" },
      numericValue: (value) => Number(value) || 0,
    },
  );
  const invalidOnlyState = {
    confirmedSupply: 0,
    invalidEvents: [state.invalidEvents[0]],
  };
  const emptyIssuance = { complete: true, confirmedMints: 0 };
  assert.equal(
    inceptionInvalidOnlyVerifierStateResolved(
      invalidOnlyState,
      emptyIssuance,
      invalidTxid,
      { blockHash },
      currentBlockHeight,
    ),
    true,
  );
  assert.equal(
    inceptionInvalidOnlyVerifierStateResolved(
      invalidOnlyState,
      emptyIssuance,
      validTxid,
      { blockHash },
      currentBlockHeight,
    ),
    false,
    "an invalid sibling cannot authorize another target's zero-supply state",
  );
  assert.equal(
    inceptionInvalidOnlyVerifierStateResolved(
      invalidOnlyState,
      emptyIssuance,
      invalidTxid,
      { blockHash: "f".repeat(64) },
      currentBlockHeight,
    ),
    false,
    "an invalid disposition from another block cannot authorize zero supply",
  );

  const dispositionOptions = {
    allowCurrentBlockInvalidAttachmentDisposition: true,
    currentBlockHash: blockHash,
    currentBlockHeight,
  };
  assert.equal(
    currentBlockRejectedInceptionAttachmentDispositions(
      [seedMint(invalidTxid, 1)],
      [invalidBond],
      { workTokenState: { invalidEvents: [], transfers: [] } },
      dispositionOptions,
    ).length,
    0,
    "an unmatched attachment without an explicit WORK replay rejection must fail closed",
  );
  assert.equal(
    currentBlockRejectedInceptionAttachmentDispositions(
      [{ ...seedMint(invalidTxid, 1), blockHash: "f".repeat(64) }],
      [invalidBond],
      {
        workTokenState: {
          invalidEvents: [invalidWorkEvent],
          transfers: [],
        },
      },
      dispositionOptions,
    ).length,
    0,
    "a seed mint outside the exact current block must not become a durable invalid disposition",
  );
  assert.equal(
    currentBlockRejectedInceptionAttachmentDispositions(
      [{ ...seedMint(invalidTxid, 1), blockIndex: 2 }],
      [invalidBond],
      {
        workTokenState: {
          invalidEvents: [invalidWorkEvent],
          transfers: [],
        },
      },
      dispositionOptions,
    ).length,
    0,
    "misaligned bond and seed provenance must fail closed",
  );

  const inceptionInvalidMintDispositionMatchesBond = isolatedFunction(
    API_PATH,
    "inceptionInvalidMintDispositionMatchesBond",
    {
      INCB_TOKEN_ID: tokenId,
      INCEPTION_BOND_CONFIG: { kind: "inception-bond" },
    },
  );
  const inceptionBondHasExplicitlyRejectedMint = isolatedFunction(
    API_PATH,
    "inceptionBondHasExplicitlyRejectedMint",
    {
      INCB_TOKEN_ID: tokenId,
      inceptionInvalidMintDispositionMatchesBond,
    },
  );
  const inceptionVerifierBondActivity = isolatedFunction(
    API_PATH,
    "inceptionVerifierBondActivity",
    {
      inceptionBondHasExplicitlyRejectedMint,
      isInceptionBondActivityItem: (item) => item?.kind === "inception-bond",
    },
  );
  const nextBlockActivity = inceptionVerifierBondActivity(
    [invalidBond, validBond, nextBlockBond],
    state,
  );
  assert.equal(nextBlockActivity.some((item) => item.txid === invalidTxid), false);
  assert.equal(nextBlockActivity.some((item) => item.txid === validTxid), true);
  assert.equal(nextBlockActivity.some((item) => item.txid === nextBlockTxid), true);
});

check("credit mint persistence requires a prior confirmed definition", async () => {
  const tokenId = "d".repeat(64);
  const canonicalBondMintProjection = () => false;
  const tokenMintDefinitionOrderInvalidReason = isolatedFunction(
    BACKFILL_PATH,
    "tokenMintDefinitionOrderInvalidReason",
    {
      NETWORK: "livenet",
      canonicalBondMintProjection,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
    },
  );
  const item = {
    blockHeight: 200,
    blockIndex: 4,
    confirmed: true,
    kind: "token-mint",
    tokenId,
  };
  const clientFor = (row) => ({
    async query() {
      return { rows: row ? [row] : [] };
    },
  });

  assert.match(
    await tokenMintDefinitionOrderInvalidReason(clientFor(null), item),
    /not confirmed before/u,
  );
  assert.match(
    await tokenMintDefinitionOrderInvalidReason(
      clientFor({
        confirmed: true,
        created_height: 201,
        metadata: { blockIndex: 0 },
      }),
      item,
    ),
    /appears before/u,
  );
  assert.match(
    await tokenMintDefinitionOrderInvalidReason(
      clientFor({
        confirmed: true,
        created_height: 200,
        metadata: { blockIndex: 4 },
      }),
      item,
    ),
    /does not appear after/u,
  );
  assert.equal(
    await tokenMintDefinitionOrderInvalidReason(
      clientFor({
        confirmed: true,
        created_height: 200,
        metadata: { blockIndex: 3 },
      }),
      item,
    ),
    "",
  );
});

check("unproven verifier holder snapshots cannot publish balances", async () => {
  let upserts = 0;
  const persistPreparedProtocolItems = isolatedFunction(
    BACKFILL_PATH,
    "persistPreparedProtocolItems",
    {
      BOND_TAGS: [],
      sourceLabelForProtocolItem: () => "token-transfers",
      CANONICAL_REBUILD: false,
      POWB_REGISTRY_ID: "infinity",
      protocolIntegrityItemForPersistence: async (_client, item) => item,
      seedCanonicalBondDefinition: async () => false,
      upsertEvent: async () => {
        upserts += 1;
        return { skipped: false };
      },
    },
  );
  const result = await persistPreparedProtocolItems(
    {
      async query() {
        assert.fail("holder snapshot attempted a database write");
      },
    },
    [
      {
        balanceSnapshot: {
          holders: [{ address: "bc1unproven", balance: 999 }],
          tokenId: "4".repeat(64),
        },
        item: { kind: "token-transfer", txid: "5".repeat(64) },
      },
    ],
  );
  assert.equal(upserts, 1);
  assert.equal(result.indexed, 1);
});

check("complete canonical token replay publishes conserved balances", async () => {
  const tokenId = "4".repeat(64);
  const writes = [];
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { NETWORK: "livenet" },
  );
  const client = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return {
          rows: [{
            confirmed: true,
            created_height: 100,
            max_supply: "100",
            metadata: { blockIndex: 0 },
            ticker: "TEST",
            token_id: tokenId,
          }],
        };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          rows: [
            {
              canonical_block_height: 101,
              event_id: 1,
              kind: "token-mint",
              payload: {
                _powEventIndex: 0,
                amount: 10,
                blockIndex: 0,
                minterAddress: "alice",
                tokenId,
              },
              txid: "1".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_id: 2,
              kind: "token-transfer",
              payload: {
                _powEventIndex: 0,
                amount: 3,
                blockIndex: 1,
                recipientAddress: "bob",
                senderAddress: "alice",
                tokenId,
              },
              txid: "2".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_id: 3,
              kind: "token-sale",
              payload: {
                _powEventIndex: 0,
                amount: 2,
                blockIndex: 2,
                buyerAddress: "carol",
                sellerAddress: "alice",
                tokenId,
              },
              txid: "3".repeat(64),
            },
          ].reverse(),
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return { rows: [{ confirmed_supply: "10", token_id: tokenId }] };
      }
      writes.push({ params: Array.from(params ?? []), sql: text });
      return { rows: [] };
    },
  };
  const result = await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
  assert.deepEqual({ holders: result.holders, tokens: result.tokens }, { holders: 3, tokens: 1 });
  const inserts = writes.filter((write) =>
    write.sql.includes("INSERT INTO proof_indexer.credit_balances"),
  );
  assert.equal(writes.filter((write) => write.sql.includes("DELETE FROM")).length, 1);
  assert.deepEqual(
    inserts.map((write) => [write.params[2], write.params[3]]),
    [
      ["alice", "5"],
      ["bob", "3"],
      ["carol", "2"],
    ],
  );
});

check("stored supply can decrease only in the explicit scoped INCB repair", async () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { INCB_TOKEN_ID: tokenId, NETWORK: "livenet" },
  );
  const clientFor = (writes) => ({
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return {
          rows: [{
            confirmed: true,
            created_height: 100,
            max_supply: "100",
            metadata: { blockIndex: 0 },
            ticker: "TEST",
            token_id: tokenId,
          }],
        };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          rows: [{
            canonical_block_height: 101,
            event_id: 1,
            kind: "token-mint",
            payload: {
              _powEventIndex: 0,
              amount: 10,
              blockIndex: 0,
              minterAddress: "alice",
              tokenId,
            },
            txid: "1".repeat(64),
          }],
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return {
          rows: [{ confirmed_supply: "20", token_id: tokenId }],
        };
      }
      writes.push({ params: Array.from(params), sql: text });
      return { rows: [] };
    },
  });

  const defaultWrites = [];
  await rejection(
    rebuildConfirmedCreditBalancesFromCanonicalEvents(
      clientFor(defaultWrites),
      { tokenIds: [tokenId] },
    ),
    (error) => /incomplete: stored 20, replayed 10/u.test(error.message),
    "A normal scoped replay lowered stored supply",
  );
  assert.equal(defaultWrites.length, 0);

  const repairWrites = [];
  const repaired = await rebuildConfirmedCreditBalancesFromCanonicalEvents(
    clientFor(repairWrites),
    {
      supplyCorrectionMode: "canonical-incb-issuance-repair",
      supplyCorrectionTokenIds: [tokenId],
      tokenIds: [tokenId],
    },
  );
  assert.deepEqual(Array.from(repaired.correctedSupplyTokenIds), [tokenId]);
  assert.ok(
    repairWrites.some((write) =>
      write.sql.includes("DELETE FROM proof_indexer.credit_balances"),
    ),
  );

  await rejection(
    rebuildConfirmedCreditBalancesFromCanonicalEvents(clientFor([]), {
      supplyCorrectionMode: "canonical-incb-issuance-repair",
      supplyCorrectionTokenIds: [tokenId],
    }),
    (error) => /restricted to the explicit scoped INCB issuance repair/u.test(
      error.message,
    ),
    "An unscoped caller acquired the supply correction capability",
  );
});

check("canonical INCB mint recovery binds the verifier minter", () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const rawProtocolItemMatchesCanonical = isolatedFunction(
    BACKFILL_PATH,
    "rawProtocolItemMatchesCanonical",
    {
      INCB_TOKEN_ID: tokenId,
      canonicalBondMintProjectionStructure: () => true,
    },
  );
  const raw = {
    amount: "546",
    kind: "token-mint",
    minterAddress: "bond-recipient",
    tokenId,
  };
  const canonical = {
    amount: "1421799461",
    kind: "token-mint",
    minterAddress: "bond-recipient",
    tokenId,
  };
  assert.equal(
    rawProtocolItemMatchesCanonical(raw, canonical, "token-mint"),
    true,
  );
  assert.equal(
    rawProtocolItemMatchesCanonical(
      raw,
      { ...canonical, minterAddress: "different-recipient" },
      "token-mint",
    ),
    false,
  );
  assert.equal(
    rawProtocolItemMatchesCanonical(
      { ...raw, minterAddress: "" },
      canonical,
      "token-mint",
    ),
    false,
  );
});

check("canonical indexer binds exact verified WORK transfers to every PWM mail kind", () => {
  const workTokenId = "4".repeat(64);
  const txid = "d".repeat(64);
  const recipientAddress = "bc1qinceptionrecipient";
  const sameCanonicalPaymentAddress = isolatedFunction(
    BACKFILL_PATH,
    "sameCanonicalPaymentAddress",
  );
  const bindAttachments = isolatedFunction(
    BACKFILL_PATH,
    "preparedProtocolItemsWithCanonicalMailAttachments",
    {
      MAIL_WORK_ATTACHMENT_KINDS: new Set([
        "attachment",
        "browser",
        "file",
        "inception-bond",
        "infinity-bond",
        "mail",
        "reply",
      ]),
      Map,
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_TICKER: "WORK",
      canonicalWorkAtomsText: (value) =>
        /^(?:[1-9]\d*)$/u.test(String(value ?? ""))
          ? String(value)
          : "",
      formatWorkAtoms: (value) => {
        const atoms = String(value).padStart(9, "0");
        const whole = atoms.slice(0, -8) || "0";
        const fraction = atoms.slice(-8).replace(/0+$/u, "");
        return fraction ? `${whole}.${fraction}` : whole;
      },
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      sameCanonicalPaymentAddress,
      withWorkPrecisionMetadata: (value) => ({
        ...value,
        amountStorageModel: "work-atoms-v1",
        decimals: 8,
        unitScale: "100000000",
      }),
    },
  );
  const prepared = [
    {
      item: {
        attachedCredits: [{ amount: "999", tokenId: workTokenId }],
        confirmed: true,
        kind: "inception-bond",
        recipients: [{ address: recipientAddress, amountSats: "546", vout: 0 }],
        txid,
      },
      sourceLabel: "log",
    },
    {
      item: {
        _powEventIndex: 2,
        amount: "20999999.99999999",
        amountAtoms: "2099999999999999",
        confirmed: true,
        kind: "token-transfer",
        protocolVout: 3,
        recipientAddress: recipientAddress.toUpperCase(),
        ticker: "WORK",
        tokenId: workTokenId,
        txid,
        valid: true,
      },
      sourceLabel: "token-transfers",
    },
    {
      item: {
        amount: "25",
        amountAtoms: "2500000000",
        confirmed: true,
        kind: "token-transfer",
        protocolVout: 4,
        recipientAddress,
        tokenId: workTokenId,
        txid,
        valid: false,
      },
      sourceLabel: "token-invalid-events",
    },
    {
      item: {
        amount: "100",
        amountAtoms: "10000000000",
        confirmed: true,
        kind: "token-transfer",
        protocolVout: 5,
        recipientAddress: "bc1qwrongrecipient",
        tokenId: workTokenId,
        txid,
        valid: true,
      },
      sourceLabel: "token-transfers",
    },
  ];

  for (const kind of [
    "attachment",
    "browser",
    "file",
    "inception-bond",
    "infinity-bond",
    "mail",
    "reply",
  ]) {
    const [boundMail] = bindAttachments([
      { ...prepared[0], item: { ...prepared[0].item, kind } },
      prepared[1],
      prepared[2],
      prepared[3],
    ]);
    assert.equal(boundMail.sourceLabel, "log");
    assert.equal(boundMail.item.attachedCredits.length, 1);
    assert.equal(boundMail.item.attachedCredits[0]._powEventIndex, 2);
    assert.equal(boundMail.item.attachedCredits[0].amount, "20999999.99999999");
    assert.equal(
      boundMail.item.attachedCredits[0].amountAtoms,
      "2099999999999999",
    );
    assert.equal(boundMail.item.attachedCredits[0].protocolVout, 3);
    assert.equal(
      boundMail.item.attachedCredits[0].recipientAddress,
      recipientAddress.toUpperCase(),
    );
    assert.equal(boundMail.item.attachedCredits[0].ticker, "WORK");
    assert.equal(boundMail.item.attachedCredits[0].tokenId, workTokenId);
  }

  const withoutCanonicalTransfer = bindAttachments([
    prepared[0],
    prepared[2],
  ]);
  assert.equal(withoutCanonicalTransfer[0].item.attachedCredits, undefined);

  const duplicateCanonicalVout = bindAttachments([
    prepared[0],
    prepared[1],
    {
      ...prepared[1],
      item: {
        ...prepared[1].item,
        _powEventIndex: 3,
        amount: "1",
        amountAtoms: "100000000",
      },
    },
  ]);
  assert.equal(
    duplicateCanonicalVout[0].item.attachedCredits,
    undefined,
    "duplicate canonical WORK rows for one protocol vout must fail closed",
  );

  const pending = bindAttachments([
    {
      item: {
        ...prepared[0].item,
        confirmed: false,
        kind: "mail",
      },
    },
    { ...prepared[1], item: { ...prepared[1].item, confirmed: false } },
  ]);
  assert.equal(
    pending[0].item.attachedCredits,
    undefined,
    "pending indexed rows must not trust projected attachedCredits",
  );
});

check("confirmed INCB metadata is fully bound to its recipient and block", () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const txid =
    "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4";
  const blockHash =
    "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5";
  const exactSafeInteger = isolatedFunction(
    READER_PATH,
    "exactSafeInteger",
  );
  const incbExactIssuanceMetadata = isolatedFunction(
    READER_PATH,
    "incbExactIssuanceMetadata",
  );
  const incbIssuanceMetadataFault = isolatedFunction(
    READER_PATH,
    "incbIssuanceMetadataFault",
    {
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      INCB_TOKEN_ID: tokenId,
      exactSafeInteger,
      incbExactIssuanceMetadata,
    },
  );
  const payload = {
    amount: "1421799461",
    amountSats: 0,
    attachedWorkAmount: "3644060",
    attachedWorkIssuanceUnits: "1421798915",
    attachedWorkLiveFloorAtSendSats: 390.168909301053,
    attachedWorkLiveValueAtSendSats: 1421798915.6275952,
    blockHash,
    blockHeight: 957950,
    blockIndex: 382,
    confirmed: true,
    confirmedIssuanceUnits: "1421799461",
    directProofIssuanceUnits: "546",
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceAmount: "1421799461",
    issuanceCheckpointBlockHash: blockHash,
    issuanceCheckpointBlockHeight: "957950",
    issuanceCheckpointBlockIndex: "382",
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceValueSnapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    issuanceValueSnapshotBlockHeight: "957949",
    issuanceValueSnapshotCanonicalSummaryHash:
      "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc",
    issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
    issuanceValueSnapshotId: "b8e77cd30cbed6855977c514",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueSats: 8193547095.322113,
    issuanceDustSats: 0.6275951862335205,
    issuanceFloorSats: 1.0000000004414091,
    issuanceNetworkValueSats: 1421799461.6275952,
    issuanceUnitSats: 1,
    issuanceValuationFixedAtSend: true,
    bondRecipientAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    bondRecipientAmountSats: "546",
    bondRecipientVout: 0,
    minterAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    paidSats: "546",
    proofPaymentSats: "546",
    sourceBondTxid: txid,
    ticker: "INCB",
    tokenId,
    txid,
    validationMode: "canonical-incb-bond-projection",
  };
  const row = {
    block_hash: blockHash,
    block_height: 957950,
    block_index: 382,
    status: "confirmed",
    token_id: tokenId,
    txid,
  };
  assert.equal(incbIssuanceMetadataFault(payload, row), "");
  assert.match(
    incbIssuanceMetadataFault({ ...payload, minterAddress: "" }, row),
    /recipient is missing/u,
  );
  assert.match(
    incbIssuanceMetadataFault(
      { ...payload, sourceBondTxid: "f".repeat(64) },
      row,
    ),
    /not bound/u,
  );
  assert.match(
    incbIssuanceMetadataFault(payload, {
      ...row,
      block_hash: "e".repeat(64),
    }),
    /not bound/u,
  );

  const fractionalPayload = {
    ...payload,
    amount: "546",
    attachedWorkAmount: "0.00000001",
    attachedWorkAmountAtoms: "1",
    attachedWorkIssuanceUnits: "0",
    attachedWorkLiveFloorAtSendSats: 1,
    attachedWorkLiveValueAtSendQ8: "1",
    attachedWorkLiveValueAtSendSats: 0.00000001,
    confirmedIssuanceUnits: "546",
    issuanceAmount: "546",
    issuanceDustQ8: "1",
    issuanceDustSats: 0.00000001,
    issuanceFloorSats: 546.00000001 / 546,
    issuanceNetworkValueQ8: "54600000001",
    issuanceNetworkValueSats: 546.00000001,
    issuanceValueSnapshotWorkNetworkValueQ8: "2100000000000000",
    issuanceValueSnapshotWorkNetworkValueSats: 21_000_000,
  };
  assert.equal(
    incbIssuanceMetadataFault(fractionalPayload, row),
    "",
    "one numeric atom of attached WORK may contribute only issuance dust",
  );
  const proofOnlyExactPayload = {
    ...fractionalPayload,
    amount: "546",
    attachedWorkAmount: "0",
    attachedWorkAmountAtoms: "0",
    attachedWorkIssuanceUnits: "0",
    attachedWorkLiveValueAtSendQ8: "0",
    attachedWorkLiveValueAtSendSats: 0,
    confirmedIssuanceUnits: "546",
    issuanceAmount: "546",
    issuanceDustQ8: "0",
    issuanceDustSats: 0,
    issuanceFloorSats: 1,
    issuanceNetworkValueQ8: "54600000000",
    issuanceNetworkValueSats: 546,
  };
  assert.equal(
    incbIssuanceMetadataFault(proofOnlyExactPayload, row),
    "",
    "a current exact proof-only bond must preserve a canonical zero WORK attachment",
  );
  assert.match(
    incbIssuanceMetadataFault(
      { ...fractionalPayload, attachedWorkLiveValueAtSendQ8: "2" },
      row,
    ),
    /does not conserve value/u,
  );
  const {
    issuanceDustQ8: _missingIssuanceDustQ8,
    ...incompleteFractionalPayload
  } = fractionalPayload;
  assert.match(
    incbIssuanceMetadataFault(incompleteFractionalPayload, row),
    /incomplete or noncanonical/u,
  );
  assert.match(
    incbIssuanceMetadataFault(
      { ...fractionalPayload, attachedWorkAmountAtoms: "01" },
      row,
    ),
    /incomplete or noncanonical/u,
  );
  assert.match(
    incbIssuanceMetadataFault(
      { ...fractionalPayload, attachedWorkAmount: "0.00000002" },
      row,
    ),
    /disagrees with projected values/u,
  );

  const productionTxid =
    "e1ecc4b4be95a6771801d516380eb20a0f8e3c0b2fb1045599a57d5a68fa1698";
  const productionBlockHash =
    "000000000000000000021fb7871138c76c262471fe3b178e8829d62cbf167ae8";
  const productionPayload = {
    ...payload,
    amount: "116657103344743",
    attachedWorkAmount: 3_988_000,
    attachedWorkAmountAtoms: "398800000000000",
    attachedWorkIssuanceUnits: "116657103344197",
    attachedWorkLiveFloorAtSendSats: 29_252_031.931844823,
    attachedWorkLiveValueAtSendQ8: "11665710334419713836190",
    attachedWorkLiveValueAtSendSats: 116_657_103_344_197.14,
    blockHash: productionBlockHash,
    blockHeight: 958_432,
    blockIndex: 1_653,
    confirmedIssuanceUnits: "116657103344743",
    issuanceAmount: "116657103344743",
    issuanceCheckpointBlockHash: productionBlockHash,
    issuanceCheckpointBlockHeight: 958_432,
    issuanceCheckpointBlockIndex: 1_653,
    issuanceDustQ8: "13836190",
    issuanceDustSats: 0.1383619,
    issuanceFloorSats: 1.000000000000001,
    issuanceNetworkValueQ8: "11665710334474313836190",
    issuanceNetworkValueSats: 116_657_103_344_743.14,
    issuanceValueSnapshotBlockHash:
      "0000000000000000000108134886191cca47cb3db5df607c7c5aa9a02e957b3f",
    issuanceValueSnapshotBlockHeight: 958_431,
    issuanceValueSnapshotCanonicalSummaryHash:
      "5b44677748e3a68e1ea376f8a2226277d9a53907279aff8ac4d2ba56524c6cfb",
    issuanceValueSnapshotGeneratedAt: "2026-07-17T21:12:25.822Z",
    issuanceValueSnapshotId: "ff4bf2984490c79d326866e3",
    issuanceValueSnapshotWorkNetworkValueQ8:
      "61429267056874120000000",
    issuanceValueSnapshotWorkNetworkValueSats: 614_292_670_568_741.2,
    sourceBondTxid: productionTxid,
    txid: productionTxid,
  };
  const productionRow = {
    ...row,
    block_hash: productionBlockHash,
    block_height: 958_432,
    block_index: 1_653,
    txid: productionTxid,
  };
  assert.ok(
    Math.abs(
      productionPayload.issuanceDustSats -
        (productionPayload.issuanceNetworkValueSats -
          Number(productionPayload.amount)),
    ) > 1e-6,
    "the production reader fixture must reproduce float dust subtraction drift",
  );
  assert.equal(
    incbIssuanceMetadataFault(productionPayload, productionRow),
    "",
    "exact Q8 metadata must remain authoritative when float subtraction loses production-scale dust",
  );
  const hugeSnapshotNetworkValueQ8 = 10n ** 321n + 12_345_678n;
  const hugeIssuanceNetworkValueQ8 =
    hugeSnapshotNetworkValueQ8 + 546n * BOND_VALUE_Q8_SCALE;
  const hugeConfirmedIssuanceUnits =
    hugeIssuanceNetworkValueQ8 / BOND_VALUE_Q8_SCALE;
  const hugeAttachedIssuanceUnits =
    hugeSnapshotNetworkValueQ8 / BOND_VALUE_Q8_SCALE;
  const hugeAttachedFloorQ8 =
    hugeSnapshotNetworkValueQ8 / 21_000_000n;
  const hugePayload = {
    ...productionPayload,
    amount: hugeConfirmedIssuanceUnits.toString(),
    attachedWorkAmount: "21000000",
    attachedWorkAmountAtoms: WORK_TOKEN_MAX_SUPPLY_ATOMS.toString(),
    attachedWorkIssuanceUnits: hugeAttachedIssuanceUnits.toString(),
    attachedWorkLiveFloorAtSendQ8: hugeAttachedFloorQ8.toString(),
    attachedWorkLiveFloorAtSendSats:
      decimalTextFromQ8(hugeAttachedFloorQ8),
    attachedWorkLiveValueAtSendQ8: hugeSnapshotNetworkValueQ8.toString(),
    attachedWorkLiveValueAtSendSats:
      decimalTextFromQ8(hugeSnapshotNetworkValueQ8),
    confirmedIssuanceUnits: hugeConfirmedIssuanceUnits.toString(),
    issuanceAmount: hugeConfirmedIssuanceUnits.toString(),
    issuanceDustQ8: (
      hugeIssuanceNetworkValueQ8 % BOND_VALUE_Q8_SCALE
    ).toString(),
    issuanceDustSats: decimalTextFromQ8(
      hugeIssuanceNetworkValueQ8 % BOND_VALUE_Q8_SCALE,
    ),
    issuanceFloorSats: decimalTextFromQ8(
      hugeIssuanceNetworkValueQ8 / hugeConfirmedIssuanceUnits,
    ),
    issuanceNetworkValueQ8: hugeIssuanceNetworkValueQ8.toString(),
    issuanceNetworkValueSats: decimalTextFromQ8(
      hugeIssuanceNetworkValueQ8,
    ),
    issuanceValueSnapshotWorkNetworkValueQ8:
      hugeSnapshotNetworkValueQ8.toString(),
    issuanceValueSnapshotWorkNetworkValueSats:
      decimalTextFromQ8(hugeSnapshotNetworkValueQ8),
  };
  assert.equal(
    Number.isFinite(Number(hugePayload.issuanceNetworkValueSats)),
    false,
  );
  assert.equal(
    incbIssuanceMetadataFault(hugePayload, productionRow),
    "",
    "the reader must accept conserved exact Q8 issuance beyond Number's finite range",
  );
  assert.match(
    incbIssuanceMetadataFault(
      {
        ...hugePayload,
        attachedWorkLiveValueAtSendQ8: (
          hugeSnapshotNetworkValueQ8 + 1n
        ).toString(),
      },
      productionRow,
    ),
    /does not conserve value/u,
  );
  assert.match(
    incbIssuanceMetadataFault(
      {
        ...hugePayload,
        issuanceValueSnapshotWorkNetworkValueQ8: "not-q8",
      },
      productionRow,
    ),
    /incomplete or noncanonical/u,
  );

  const canonicalLegacyDecimalValue = isolatedFunction(
    READER_PATH,
    "canonicalLegacyDecimalValue",
    { decimalTextFromQ8, q8TextFromDecimal, rowNumber },
  );
  const tokenMintFromEventPayload = isolatedFunction(
    READER_PATH,
    "tokenMintFromEventPayload",
    {
      INCB_TOKEN_ID: tokenId,
      canonicalLegacyDecimalValue,
      canonicalEventIdentityDetails: () => ({}),
      dateIso: (value) => String(value ?? ""),
      incbExactIssuanceMetadata,
      incbIssuanceMetadataFault,
      isWorkTokenId: () => false,
      rowNumber: (record, key) => {
        const number = Number(record?.[key]);
        return Number.isFinite(number) ? number : 0;
      },
      tokenMarketNumbersFromTags: () => ({}),
      workAmountProjection: () => null,
    },
  );
  const fractionalMint = tokenMintFromEventPayload(fractionalPayload, row);
  assert.deepEqual(
    {
      attachedWorkAmountAtoms: fractionalMint.attachedWorkAmountAtoms,
      attachedWorkLiveValueAtSendQ8:
        fractionalMint.attachedWorkLiveValueAtSendQ8,
      issuanceDustQ8: fractionalMint.issuanceDustQ8,
      issuanceNetworkValueQ8: fractionalMint.issuanceNetworkValueQ8,
      issuanceValueSnapshotWorkNetworkValueQ8:
        fractionalMint.issuanceValueSnapshotWorkNetworkValueQ8,
    },
    {
      attachedWorkAmountAtoms: "1",
      attachedWorkLiveValueAtSendQ8: "1",
      issuanceDustQ8: "1",
      issuanceNetworkValueQ8: "54600000001",
      issuanceValueSnapshotWorkNetworkValueQ8: "2100000000000000",
    },
  );
  const productionMint = tokenMintFromEventPayload(
    productionPayload,
    productionRow,
  );
  assert.equal(
    productionMint.issuanceNetworkValueQ8,
    "11665710334474313836190",
    "the current-table reader must preserve production-scale exact issuance metadata",
  );
  const hugeMint = tokenMintFromEventPayload(hugePayload, productionRow);
  assert.equal(
    hugeMint.issuanceNetworkValueQ8,
    hugeIssuanceNetworkValueQ8.toString(),
  );
  assert.equal(
    hugeMint.issuanceNetworkValueSats,
    decimalTextFromQ8(hugeIssuanceNetworkValueQ8),
    "the reader must project the huge exact value as decimal text without Number coercion",
  );
  assert.equal(hugeMint.amount, hugeConfirmedIssuanceUnits.toString());
  const legacyMint = tokenMintFromEventPayload(payload, row);
  assert.equal(legacyMint.attachedWorkAmount, 3_644_060);
  assert.equal("attachedWorkAmountAtoms" in legacyMint, false);
  assert.equal("issuanceNetworkValueQ8" in legacyMint, false);
  const legacySqlMint = tokenMintFromEventPayload(payload, {
    ...row,
    attached_work_live_floor_at_send_sats_text: "390.168909301053",
    attached_work_live_value_at_send_sats_text: "1421798915.6275952",
    issuance_dust_sats_text: "0.6275951862335205",
    issuance_floor_sats_text: "1.0000000004414091",
    issuance_network_value_sats_text: "1421799461.6275952",
    issuance_value_snapshot_work_network_value_sats_text:
      "8193547095.322113",
  });
  assert.equal(
    legacySqlMint.attachedWorkLiveFloorAtSendSats,
    "390.168909301053",
  );
  assert.equal(
    legacySqlMint.attachedWorkLiveValueAtSendSats,
    "1421798915.6275952",
  );
  assert.equal(legacySqlMint.issuanceDustSats, "0.6275951862335205");
  assert.equal(legacySqlMint.issuanceFloorSats, "1.0000000004414091");
  assert.equal(
    legacySqlMint.issuanceNetworkValueSats,
    "1421799461.6275952",
  );
  assert.equal(
    legacySqlMint.issuanceValueSnapshotWorkNetworkValueSats,
    "8193547095.322113",
    "the SQL text lane must preserve the real legacy H-1 projection without Number",
  );
  assert.equal(
    canonicalLegacyDecimalValue(
      { attachedWorkLiveFloorAtSendSats: "390.16890930" },
      "attachedWorkLiveFloorAtSendSats",
    ),
    "390.1689093",
  );
  assert.equal(
    canonicalLegacyDecimalValue(
      { attachedWorkLiveValueAtSendSats: "1421798915.62759520" },
      "attachedWorkLiveValueAtSendSats",
    ),
    "1421798915.6275952",
  );
  assert.equal(
    canonicalLegacyDecimalValue(
      { issuanceDustSats: "0.62759520" },
      "issuanceDustSats",
    ),
    "0.6275952",
  );
  assert.equal(
    canonicalLegacyDecimalValue(
      { issuanceFloorSats: "1.00000000" },
      "issuanceFloorSats",
    ),
    "1",
  );
  assert.equal(
    canonicalLegacyDecimalValue(
      { issuanceNetworkValueSats: "1421799461.62759520" },
      "issuanceNetworkValueSats",
    ),
    "1421799461.6275952",
  );
  assert.equal(
    canonicalLegacyDecimalValue(
      {
        issuanceValueSnapshotWorkNetworkValueSats:
          "245242167293917.16000000",
      },
      "issuanceValueSnapshotWorkNetworkValueSats",
    ),
    "245242167293917.16",
    "legacy H-1 decimal text must not cross binary Number before Q8 aggregation",
  );
  assert.throws(
    () =>
      canonicalLegacyDecimalValue(
        { issuanceNetworkValueSats: "1e15" },
        "issuanceNetworkValueSats",
      ),
    /Invalid exact legacy decimal alias/u,
    "a present malformed SQL decimal alias must fail closed instead of falling through Number",
  );
});

check("multi-recipient bond mints survive reader identity and stats", async () => {
  const tokenId = "a".repeat(64);
  const txid = "b".repeat(64);
  const pendingTxid = "c".repeat(64);
  const tokenMintEventQueryParts = isolatedFunction(
    READER_PATH,
    "tokenMintEventQueryParts",
    {
      normalizedTxid: () => "",
      tokenHistoryFilterNeedles: () => [],
      tokenMintQueryScopeCondition: () => "true",
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const { cte } = tokenMintEventQueryParts(
    "livenet",
    tokenId,
    new URLSearchParams(),
    { limit: 100, offset: 0, page: 0, query: "", snapshotId: "" },
  );
  assert.match(cte, /WITH mint_candidates AS/u);
  assert.match(
    cte,
    /DISTINCT ON \([\s\S]*lower\(txid\)[\s\S]*mint_ordinal[\s\S]*lower\(mint_recipient_address\)/u,
  );
  assert.doesNotMatch(cte, /DISTINCT ON \(lower\(e\.txid\)\)/u);

  const rows = [
    {
      block_height: 100,
      block_time: "2026-07-14T00:00:00.000Z",
      effective_status: "confirmed",
      event_id: 1,
      mint_ordinal: 0,
      mint_recipient_address: "addrA",
      payload: {
        amount: "546",
        minterAddress: "addrA",
        ticker: "POWB",
        tokenId,
        txid,
      },
      token_id: tokenId,
      txid,
    },
    {
      block_height: 100,
      block_time: "2026-07-14T00:00:00.000Z",
      effective_status: "confirmed",
      event_id: 2,
      mint_ordinal: 1,
      mint_recipient_address: "addrB",
      payload: {
        amount: "546",
        eventKeyVout: 1,
        minterAddress: "addrB",
        ticker: "POWB",
        tokenId,
        txid,
      },
      token_id: tokenId,
      txid,
    },
    {
      block_height: null,
      block_time: null,
      effective_status: "pending",
      event_id: 3,
      mint_ordinal: 0,
      mint_recipient_address: "addrC",
      payload: {
        amount: "546",
        minterAddress: "addrC",
        ticker: "POWB",
        tokenId,
        txid: pendingTxid,
      },
      token_id: tokenId,
      txid: pendingTxid,
    },
  ];
  let parsedRows = 0;
  const proofIndexTokenMintStatsPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenMintStatsPayload",
    {
      TOKEN_STATE_EVENT_READ_LIMIT: 100_000,
      TOKEN_PENDING_MINT_WITNESS_LIMIT: 32,
      newestDateIso: (values) =>
        values.filter(Boolean).sort().at(-1) ?? undefined,
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "").toLowerCase())
          ? String(value).toLowerCase()
          : "",
      objectRecord: (value) => value ?? {},
      proofIndexPool: () => ({}),
      proofIndexTokenMintRows: async () => rows,
      rowNumber: (value, key) => Number(value?.[key] ?? 0) || 0,
      tokenMintFromEventPayload: (payload, row) => {
        parsedRows += 1;
        return {
          amount: Number(payload.amount),
          confirmed: row.effective_status === "confirmed",
          txid: row.txid,
        };
      },
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const stats = await proofIndexTokenMintStatsPayload(
    "livenet",
    tokenId,
    { targetTxid: txid },
  );
  assert.equal(parsedRows, 3);
  assert.equal(stats.confirmedMints, 2);
  assert.equal(stats.confirmedSupply, 1092);
  assert.equal(stats.pendingMints, 1);
  assert.equal(stats.pendingSupply, 546);
  assert.equal(stats.totalMints, 3);
  assert.equal(stats.pendingCandidateCount, 1);
  assert.equal(stats.pendingCandidateSupply, 546);
  assert.equal(stats.pendingCandidatesComplete, true);
  assert.equal(stats.pendingWitnessLimit, 32);
  assert.equal(stats.pendingCandidates.length, 1);
  assert.equal(stats.pendingCandidates[0].amount, 546);
  assert.equal(stats.pendingCandidates[0].txid, pendingTxid);
  assert.equal(stats.targetMintStats.confirmedMints, 2);
  assert.equal(stats.targetMintStats.pendingMints, 0);
  assert.equal(stats.targetMintStats.totalMints, 2);
  assert.equal(stats.targetMintStats.txid, txid);

  const rejectingStats = isolatedFunction(
    READER_PATH,
    "proofIndexTokenMintStatsPayload",
    {
      TOKEN_STATE_EVENT_READ_LIMIT: 100_000,
      TOKEN_PENDING_MINT_WITNESS_LIMIT: 32,
      newestDateIso: () => undefined,
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "").toLowerCase())
          ? String(value).toLowerCase()
          : "",
      objectRecord: (value) => value ?? {},
      proofIndexPool: () => ({}),
      proofIndexTokenMintRows: async () => rows,
      rowNumber: (value, key) => Number(value?.[key] ?? 0) || 0,
      tokenMintFromEventPayload: (_payload, row) => {
        if (row.event_id === 2) throw new Error("invalid canonical mint");
        return { amount: 546, confirmed: true, txid: row.txid };
      },
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  await rejection(
    rejectingStats("livenet", tokenId),
    (error) => /invalid canonical mint/u.test(error.message),
    "Mint statistics published after a row failed canonical validation",
  );
});

check("negative canonical token replay fails before balance publication", async () => {
  const tokenId = "5".repeat(64);
  let destructiveWrites = 0;
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { NETWORK: "livenet" },
  );
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return {
          rows: [{
            confirmed: true,
            created_height: 100,
            max_supply: "100",
            metadata: { blockIndex: 0 },
            ticker: "TEST",
            token_id: tokenId,
          }],
        };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          rows: [
            {
              canonical_block_height: 101,
              event_id: 1,
              kind: "token-mint",
              payload: {
                _powEventIndex: 0,
                amount: 10,
                blockIndex: 0,
                minterAddress: "alice",
                tokenId,
              },
              txid: "1".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_id: 2,
              kind: "token-transfer",
              payload: {
                _powEventIndex: 0,
                amount: 11,
                blockIndex: 1,
                recipientAddress: "bob",
                senderAddress: "alice",
                tokenId,
              },
              txid: "2".repeat(64),
            },
          ],
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return { rows: [{ confirmed_supply: "10", token_id: tokenId }] };
      }
      destructiveWrites += 1;
      return { rows: [] };
    },
  };
  await rejection(
    rebuildConfirmedCreditBalancesFromCanonicalEvents(client),
    (error) => /negative/u.test(error.message),
    "An overspend must fail canonical replay",
  );
  assert.equal(destructiveWrites, 0);
});

check("canonical WORK seed is atomic even from an empty cached-false definition", async () => {
  const readyCache = new WeakMap();
  const workAtomicProjectionReady = isolatedFunction(
    BACKFILL_PATH,
    "workAtomicProjectionReady",
    {
      NETWORK: "livenet",
      WORK_TOKEN_MAX_SUPPLY_ATOMS: "2100000000000000",
      WORK_TOKEN_MINT_AMOUNT_ATOMS: "100000000000",
      workAtomicProjectionReadyByClient: readyCache,
    },
  );
  const assertCanonicalWorkAtomicProjection = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalWorkAtomicProjection",
    { workAtomicProjectionReady },
  );
  const workDefinitionStorage = isolatedFunction(
    BACKFILL_PATH,
    "workDefinitionStorage",
  );
  const upsertCanonicalSyntheticCreditDefinition = isolatedFunction(
    BACKFILL_PATH,
    "upsertCanonicalSyntheticCreditDefinition",
    {
      BOND_UNCAPPED_MAX_SUPPLY_STORAGE: "0",
      NETWORK: "livenet",
      workAtomicProjectionReady,
      workDefinitionStorage,
    },
  );
  const seedCanonicalWorkDefinition = isolatedFunction(
    BACKFILL_PATH,
    "seedCanonicalWorkDefinition",
    {
      WORK_TOKEN_CREATED_AT: "2026-05-15T02:57:28.000Z",
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_TOKEN_MINT_AMOUNT: 1_000,
      WORK_TOKEN_MINT_PRICE_SATS: 1_000,
      WORK_TOKEN_REGISTRY_ADDRESS: "work-registry",
      assertCanonicalWorkAtomicProjection,
      upsertCanonicalSyntheticCreditDefinition,
    },
  );
  let storedDefinition = null;
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ params: Array.from(params), sql: text });
      if (text.includes("SELECT max_supply::text")) {
        return {
          rows: storedDefinition
            ? [{
                max_supply: storedDefinition.maxSupply,
                metadata: storedDefinition.metadata,
                mint_amount: storedDefinition.mintAmount,
              }]
            : [],
        };
      }
      if (text.includes("INSERT INTO proof_indexer.credit_definitions")) {
        storedDefinition = {
          maxSupply: String(params[5]),
          metadata: JSON.parse(String(params[8])),
          mintAmount: String(params[6]),
        };
      }
      return { rows: [] };
    },
  };

  assert.equal(
    await workAtomicProjectionReady(client),
    false,
    "the empty table must cache the exact failure reproduced by the clone",
  );
  await seedCanonicalWorkDefinition(client);
  assert.equal(storedDefinition.maxSupply, "2100000000000000");
  assert.equal(storedDefinition.mintAmount, "100000000000");
  assert.deepEqual(
    {
      amountStorageModel: storedDefinition.metadata.amountStorageModel,
      decimals: storedDefinition.metadata.decimals,
      maxSupply: storedDefinition.metadata.maxSupply,
      maxSupplyAtoms: storedDefinition.metadata.maxSupplyAtoms,
      mintAmount: storedDefinition.metadata.mintAmount,
      mintAmountAtoms: storedDefinition.metadata.mintAmountAtoms,
      unitScale: storedDefinition.metadata.unitScale,
    },
    {
      amountStorageModel: "work-atoms-v1",
      decimals: 8,
      maxSupply: "21000000",
      maxSupplyAtoms: "2100000000000000",
      mintAmount: "1000",
      mintAmountAtoms: "100000000000",
      unitScale: "100000000",
    },
  );
  assert.equal(storedDefinition.metadata.canonicalSynthetic, true);
  assert.equal(await workAtomicProjectionReady(client, { refresh: true }), true);
  assert.equal(
    calls.filter((call) => call.sql.includes("SELECT max_supply::text")).length,
    3,
    "the seed must ignore cached false for its write and refresh the stored row",
  );
});

check("range replay atomic source rejects legacy and hybrid WORK state", async () => {
  const legacySource = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalWorkAtomicSource",
    {
      assertCanonicalWorkAtomicProjection: async () => true,
      auditWorkAtomicProjection: async () => ({ atomic: false, legacy: true }),
      canonicalWorkAtomicConservation: async () => {
        throw new Error("conservation must not run for legacy state");
      },
    },
  );
  await rejection(
    legacySource({}, "PWT range replay source projection"),
    (error) => /fully atomic WORK source projection/u.test(error.message),
  );

  const hybridSource = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalWorkAtomicSource",
    {
      assertCanonicalWorkAtomicProjection: async () => true,
      auditWorkAtomicProjection: async () => ({ atomic: true, legacy: false }),
      canonicalWorkAtomicConservation: async () => {
        throw new Error(
          "Canonical WORK atomic conservation failed: mints 2100000000000000, balances 21000000.",
        );
      },
    },
  );
  await rejection(
    hybridSource({}, "PWT range replay source projection"),
    (error) => /atomic conservation failed/u.test(error.message),
  );

  const canonicalWorkAtomicConservation = isolatedFunction(
    BACKFILL_PATH,
    "canonicalWorkAtomicConservation",
    { NETWORK: "livenet" },
  );
  const conserved = await canonicalWorkAtomicConservation({
    async query() {
      return {
        rows: [{
          balance_supply: "2100000000000000",
          invalid_mint_amounts: 0,
          mint_events: 21000,
          minted_supply: "2100000000000000",
          negative_balances: 0,
        }],
      };
    },
  });
  assert.deepEqual(
    { ...conserved },
    {
      balanceSupply: "2100000000000000",
      mintedSupply: "2100000000000000",
      mintEvents: 21000,
    },
  );
});

check("canonical rebuild preparation requires an explicit supervised height", () => {
  const invalid = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 0,
      CANONICAL_REBUILD: true,
      HYDRATE_TRANSACTION_DETAILS_ONLY: false,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_CANONICAL_TXIDS_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS: [],
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
    },
  );
  assert.throws(invalid, /explicit positive/u);
  const valid = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 100,
      CANONICAL_REBUILD: true,
      HYDRATE_TRANSACTION_DETAILS_ONLY: false,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_CANONICAL_TXIDS_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS: [],
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
    },
  );
  assert.doesNotThrow(valid);

  const rangeReplayWithoutExplicitApi = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: 958383,
      CANONICAL_REBUILD: false,
      HYDRATE_TRANSACTION_DETAILS_ONLY: false,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      REPAIR_CANONICAL_TXIDS_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
      explicitLoopbackApiBaseConfigured: () => false,
    },
  );
  assert.throws(rangeReplayWithoutExplicitApi, /explicit loopback POW_API_BASE/u);
  const rangeReplayWithExplicitApi = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: 958383,
      CANONICAL_REBUILD: false,
      HYDRATE_TRANSACTION_DETAILS_ONLY: false,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      REPAIR_CANONICAL_TXIDS_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
      explicitLoopbackApiBaseConfigured: () => true,
    },
  );
  assert.doesNotThrow(rangeReplayWithExplicitApi);
  const rangeReplayWithWrongBoundary = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958384,
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: 958383,
      CANONICAL_REBUILD: false,
      HYDRATE_TRANSACTION_DETAILS_ONLY: false,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      REPAIR_CANONICAL_TXIDS_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
      explicitLoopbackApiBaseConfigured: () => true,
    },
  );
  assert.throws(rangeReplayWithWrongBoundary, /958383/u);

  const hydration = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      CANONICAL_REBUILD: false,
      HYDRATE_TRANSACTION_DETAILS_ONLY: true,
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_CANONICAL_TXIDS_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
      TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX: -1,
      TX_DETAIL_HYDRATION_AFTER_HEIGHT: -1,
      TX_DETAIL_HYDRATION_AFTER_TXID: "",
      TX_DETAIL_HYDRATION_BATCH_SIZE: 200,
      TX_DETAIL_HYDRATION_MAX_ROWS: 10_000,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
    },
  );
  assert.doesNotThrow(hydration);
  const conflictingHydration = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      CANONICAL_REBUILD: true,
      HYDRATE_TRANSACTION_DETAILS_ONLY: true,
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_CANONICAL_TXIDS_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
    },
  );
  assert.throws(conflictingHydration, /exclusive/u);
});

check("canonical rebuild reset and hashed bootstrap are one transaction", async () => {
  const calls = [];
  const bootstrapHash = "a".repeat(64);
  const prepareCanonicalRebuild = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalRebuild",
    {
      BLOCK_SCAN_FROM_HEIGHT: 100,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD: true,
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      bitcoinRpc: async (method) =>
        method === "getblockhash" ? bootstrapHash : 120,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      migrateUnboundedCreditUnitStorage: async () => {
        calls.push("migrate-credit-units");
        return { storageModel: "unconstrained-integer-numeric-v1" };
      },
      proofIndexerMetaValue: async () => null,
      seedCanonicalWorkDefinition: async () => calls.push("seed-work"),
      storeBlockScanSnapshot: async (_client, payload) =>
        calls.push({ snapshot: payload }),
      storeProofIndexerMeta: async (_client, key, value) =>
        calls.push({ key, meta: value }),
    },
  );
  const client = {
    async query(sql, params = []) {
      calls.push({ params: Array.from(params), sql: String(sql).trim() });
      return { rows: [] };
    },
  };
  const prepared = await prepareCanonicalRebuild(client);
  assert.equal(prepared.resumed, false);
  assert.equal(prepared.value.bootstrapHeight, 99);
  assert.equal(prepared.value.bootstrapHash, bootstrapHash);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  const sql = calls.filter((call) => call.sql).map((call) => call.sql).join("\n");
  for (const table of [
    "proof_indexer.events",
    "proof_indexer.id_records",
    "proof_indexer.credit_balances",
    "proof_indexer.credit_listings",
    "proof_indexer.credit_definitions",
    "proof_indexer.mail_items",
    "proof_indexer.file_attachments",
    "proof_indexer.ledger_snapshots",
  ]) {
    assert.match(sql, new RegExp(table.replace(".", "\\."), "u"));
  }
  assert.doesNotMatch(
    sql,
    /DELETE FROM proof_indexer\.(?:tx_inputs|tx_outputs|op_returns)/u,
  );
  assert.match(sql, /UPDATE proof_indexer\.blocks[\s\S]*canonical = false/u);
  const eventDelete = calls.find((call) =>
    call.sql?.includes("DELETE FROM proof_indexer.events"),
  );
  assert.deepEqual(Array.from(eventDelete.params[1]), [
    "pwid1",
    "pwt1",
    "pwm1",
    "pwr1",
  ]);
  assert.ok(calls.includes("seed-work"));
  assert.ok(calls.includes("migrate-credit-units"));
  assert.ok(
    calls.some(
      (call) => call.params?.[0] === "mempoolScan:livenet",
    ),
  );
  const snapshot = calls.find((call) => call.snapshot)?.snapshot;
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.indexedThroughBlock, 99);
  assert.equal(snapshot.indexedThroughBlockHash, bootstrapHash);
});

check("resumed rebuilds reject a non-atomic canonical WORK definition", async () => {
  const atomicFailure = async () => {
    throw new Error(
      "Resumed replay requires the exact canonical WORK work-atoms-v1 definition.",
    );
  };
  const canonicalRebuild = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalRebuild",
    {
      BLOCK_SCAN_FROM_HEIGHT: 948000,
      CANONICAL_REBUILD: true,
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      assertCanonicalWorkAtomicProjection: atomicFailure,
      proofIndexerMetaValue: async () => ({
        fromHeight: 948000,
        network: "livenet",
        status: "active",
      }),
    },
  );
  await rejection(
    canonicalRebuild({}),
    (error) => /work-atoms-v1 definition/u.test(error.message),
  );

  const rangeReplay = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalPwtRangeReplay",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      assertCanonicalPwtRangeReplayState: () => "active",
      assertCanonicalWorkAtomicSource: atomicFailure,
      canonicalPwtRangeReplayVerifierBinding: () => ({
        bindingId: "f".repeat(64),
      }),
      legacyCompletedPwtRangeReplayCanBeReprepared: () => false,
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:fault"
          ? null
          : {
              active: true,
              complete: false,
              mode: "pwt-range-replay",
              network: "livenet",
              rangeReplayFromHeight: 958383,
              status: "active",
            },
    },
  );
  await rejection(
    rangeReplay({}),
    (error) => /work-atoms-v1 definition/u.test(error.message),
  );
});

check("certified PWT replay preparation is immutable", async () => {
  let databaseWrites = 0;
  let coreReads = 0;
  const prepareCanonicalPwtRangeReplay = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalPwtRangeReplay",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      assertCanonicalPwtRangeReplayState: () => "complete",
      bitcoinRpc: async () => {
        coreReads += 1;
      },
      legacyCompletedPwtRangeReplayCanBeReprepared: () => false,
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:fault"
          ? null
          : {
              active: false,
              complete: true,
              mode: "pwt-range-replay",
              network: "livenet",
              status: "complete",
            },
    },
  );
  await rejection(
    prepareCanonicalPwtRangeReplay({
      async query() {
        databaseWrites += 1;
        return { rows: [] };
      },
    }),
    (error) => /certified PWT range replay is permanent/u.test(error.message),
  );
  assert.equal(coreReads, 0);
  assert.equal(databaseWrites, 0);

  const rejectUnknownMode = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalPwtRangeReplay",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      assertCanonicalPwtRangeReplayState: () => null,
      legacyCompletedPwtRangeReplayCanBeReprepared: () => false,
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:fault"
          ? null
          : {
              active: false,
              complete: true,
              mode: "unknown-rebuild-mode",
              network: "livenet",
              status: "complete",
            },
    },
  );
  await rejection(
    rejectUnknownMode({
      async query() {
        databaseWrites += 1;
        return { rows: [] };
      },
    }),
    (error) => /unknown rebuild mode/u.test(error.message),
  );
  assert.equal(databaseWrites, 0);
});

check("legacy PWT preparation proves its stored checkpoint against Core", async () => {
  const legacy = {
    active: false,
    bootstrapHash:
      "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986",
    bootstrapHeight: 947999,
    complete: true,
    completedAt: "2026-07-18T19:29:05.182Z",
    fromHeight: 948000,
    indexedThroughBlock: 958602,
    indexedThroughBlockHash: "c".repeat(64),
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 950200,
    rangeReplayStartedAt: "2026-07-11T20:13:36.954Z",
    startedAt: "2026-07-11T17:14:57.622Z",
    status: "complete",
    transactionNormalization: "canonical-raw-tx-only",
  };
  let databaseWrites = 0;
  const prepareCanonicalPwtRangeReplay = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalPwtRangeReplay",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      assertCanonicalPwtRangeReplayState: () => {
        throw new Error("legacy completion must use the explicit migration gate");
      },
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 958602;
        if (method === "getblockhash") {
          if (Number(params[0]) === 947999) return legacy.bootstrapHash;
          if (Number(params[0]) === 958602) return "d".repeat(64);
          if (Number(params[0]) === 958382) return "b".repeat(64);
        }
        throw new Error(`unexpected Core request ${method} ${params[0]}`);
      },
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      legacyCompletedPwtRangeReplayCanBeReprepared: () => true,
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:fault" ? null : legacy,
    },
  );
  await rejection(
    prepareCanonicalPwtRangeReplay({
      async query() {
        databaseWrites += 1;
        return { rows: [] };
      },
    }),
    (error) => /not an exact ancestor/u.test(error.message),
  );
  assert.equal(databaseWrites, 0);
});

check("PWT preparation proves every predecessor checkpoint against Core", async () => {
  const existing = {
    active: false,
    bootstrapHash: "a".repeat(64),
    bootstrapHeight: 947999,
    complete: true,
    fromHeight: 948000,
    indexedThroughBlock: 958600,
    indexedThroughBlockHash: "c".repeat(64),
    network: "livenet",
    status: "complete",
  };
  let databaseWrites = 0;
  const prepareCanonicalPwtRangeReplay = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalPwtRangeReplay",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      assertCanonicalPwtRangeReplayState: () => null,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 958700;
        if (method === "getblockhash") {
          if (Number(params[0]) === 947999) return existing.bootstrapHash;
          if (Number(params[0]) === 958382) return "b".repeat(64);
          if (Number(params[0]) === 958600) return "d".repeat(64);
        }
        throw new Error(`unexpected Core request ${method} ${params[0]}`);
      },
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      legacyCompletedPwtRangeReplayCanBeReprepared: () => false,
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:fault" ? null : existing,
    },
  );
  await rejection(
    prepareCanonicalPwtRangeReplay({
      async query() {
        databaseWrites += 1;
        return { rows: [] };
      },
    }),
    (error) => /not an exact ancestor/u.test(error.message),
  );
  assert.equal(databaseWrites, 0);
});

const CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE = [
  {
    blockHash:
      "00000000000000000001db52a4485f7d1a1784b7ba6c5b93db1b20449ac2628b",
    blockHeight: 958_383,
    blockIndex: 2_421,
    blockTime: 1_784_276_401,
    bondMemoVout: 2,
    bondRecipientAddress:
      "bc1pxhs9y9ryqnhm05lyv794f6upzk0mtu2zct5w2hgc2vm3d58pvcqspptre0",
    bondRecipientAmountSats: 1_000,
    bondRecipientVout: 0,
    txid: "c9c9f4e382f598aa39b3be57adc8fe1defeb80e5216387d3af6b0948da232aff",
    workAmountAtoms: "10000000000000",
    workProtocolVout: 4,
    workRegistryPaymentVout: 3,
  },
  {
    blockHash:
      "000000000000000000022e062fe6236b71722b7ade5079d5c45e73a5561252e1",
    blockHeight: 958_429,
    blockIndex: 1_476,
    blockTime: 1_784_301_574,
    bondMemoVout: 2,
    bondRecipientAddress: "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW",
    bondRecipientAmountSats: 1_000,
    bondRecipientVout: 0,
    txid: "e08080c1d86f0770dd6ebbabd98a9e066dc6043b548af7ecb7912fbbdfad4d50",
    workAmountAtoms: "7000000000000",
    workProtocolVout: 4,
    workRegistryPaymentVout: 3,
  },
  {
    blockHash:
      "000000000000000000022e062fe6236b71722b7ade5079d5c45e73a5561252e1",
    blockHeight: 958_429,
    blockIndex: 1_483,
    blockTime: 1_784_301_574,
    bondMemoVout: 2,
    bondRecipientAddress: "1Pg9E4EHHMxQ6WgEWEVzbWhaKf3UdZKXD9",
    bondRecipientAmountSats: 1_000,
    bondRecipientVout: 0,
    txid: "45b226453dde5b4d61a6a036af299d11ebfdeb65054bf26438ebc6ebebbf00c3",
    workAmountAtoms: "11500000000000",
    workProtocolVout: 4,
    workRegistryPaymentVout: 3,
  },
  {
    blockHash:
      "0000000000000000000124119a72f9994a7e3a5a724a9826cb178ed2646639f6",
    blockHeight: 958_590,
    blockIndex: 1_945,
    blockTime: 1_784_395_736,
    bondMemoVout: 1,
    bondRecipientAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    bondRecipientAmountSats: 546,
    bondRecipientVout: 0,
    txid: "62f1a62fdf984c3c50b067cfed806023ad61d4fabd62087ecdd891554f5b51d6",
    workAmountAtoms: "357446000000000",
    workProtocolVout: 3,
    workRegistryPaymentVout: 2,
  },
];

check("INCB replay facts are pinned to exact Bitcoin Core positions", async () => {
  const workRegistryAddress = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
  const blocks = new Map();
  for (const target of CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE) {
    const block = blocks.get(target.blockHash) ?? {
      hash: target.blockHash,
      height: target.blockHeight,
      previousblockhash: "0".repeat(64),
      time: target.blockTime,
      tx: [],
    };
    block.tx[target.blockIndex] = { txid: target.txid };
    blocks.set(target.blockHash, block);
  }
  const targetByTxid = new Map(
    CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.map((target) => [
      target.txid,
      target,
    ]),
  );
  const verifyCanonicalIncbPwtRangeReplayCoreFacts = isolatedFunction(
    BACKFILL_PATH,
    "verifyCanonicalIncbPwtRangeReplayCoreFacts",
    {
      INCEPTION_BOND_MEMO: "incb",
      WORK_TOKEN_ID,
      WORK_TOKEN_REGISTRY_ADDRESS: workRegistryAddress,
      addressFromVout: (output) => output?.address ?? "",
      assertCanonicalBlockEnvelope: (block, height, hash) => {
        assert.equal(block.height, height);
        assert.equal(block.hash, hash);
      },
      assertHydratedProtocolTransaction: () => {},
      bitcoinRpc: async (method, params) => {
        if (method === "getblockhash") {
          return CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.find(
            (target) => target.blockHeight === params[0],
          )?.blockHash;
        }
        if (method === "getblock") {
          return blocks.get(params[0]);
        }
        throw new Error(`unexpected Core method ${method}`);
      },
      protocolMessagesFromTx: (tx) => {
        const target = targetByTxid.get(tx.txid);
        return [
          {
            text: "pwm1:m:incb",
            voutIndex: target.bondMemoVout,
          },
          {
            text: [
              "pwt1",
              "send2",
              WORK_TOKEN_ID,
              target.workAmountAtoms,
              target.bondRecipientAddress,
            ].join(":"),
            voutIndex: target.workProtocolVout,
          },
        ];
      },
      satsFromVoutValue: (value) => BigInt(value),
      senderAddressFromTx: (tx) => tx.senderAddress,
      transactionWithInputPrevouts: async (tx) => {
        const target = targetByTxid.get(tx.txid);
        const vout = [];
        vout[target.bondRecipientVout] = {
          address: target.bondRecipientAddress,
          value: String(target.bondRecipientAmountSats),
        };
        vout[target.workRegistryPaymentVout] = {
          address: workRegistryAddress,
          value: "546",
        };
        return {
          ...tx,
          senderAddress: target.bondRecipientAddress,
          vout,
        };
      },
    },
  );

  const verified = JSON.parse(
    JSON.stringify(
      await verifyCanonicalIncbPwtRangeReplayCoreFacts(
        CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE,
      ),
    ),
  );
  assert.deepEqual(
    verified.map((target) => target.txid),
    CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.map((target) => target.txid),
  );
  assert.ok(
    CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.every(
      (target) =>
        !Object.keys(target).some((key) => /issuance|networkValue/iu.test(key)),
    ),
    "immutable transaction facts must never pin a replay-produced issuance",
  );

  const firstTarget = CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE[0];
  const firstBlock = blocks.get(firstTarget.blockHash);
  firstBlock.tx[firstTarget.blockIndex] = { txid: "0".repeat(64) };
  await rejection(
    verifyCanonicalIncbPwtRangeReplayCoreFacts(
      CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE,
    ),
    (error) => /changed exact Core block position/u.test(error.message),
  );
});

check("PWT range replay removes whole stale txs and resets projections", async () => {
  const calls = [];
  const canonicalBootstrapHash = "a".repeat(64);
  const rangeCheckpointHash = "b".repeat(64);
  const existingRebuild = {
    active: false,
    bootstrapHash: canonicalBootstrapHash,
    bootstrapHeight: 947999,
    complete: true,
    completedAt: "2026-07-17T00:00:00.000Z",
    fromHeight: 948000,
    indexedThroughBlock: 958700,
    indexedThroughBlockHash: "c".repeat(64),
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 950200,
    rangeReplayStartedAt: "2026-07-16T23:59:00.000Z",
    startedAt: "2026-07-11T17:14:57.622Z",
    status: "complete",
    transactionNormalization: "canonical-raw-tx-only",
  };
  let storedRebuildMeta = existingRebuild;
  const legacyCompletedPwtRangeReplayCanBeReprepared = isolatedFunction(
    BACKFILL_PATH,
    "legacyCompletedPwtRangeReplayCanBeReprepared",
    {
      CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT: 958383,
      LEGACY_PWT_CANONICAL_BOOTSTRAP_HASH: canonicalBootstrapHash,
      LEGACY_PWT_CANONICAL_BOOTSTRAP_HEIGHT: 947999,
      LEGACY_PWT_CANONICAL_FROM_HEIGHT: 948000,
      LEGACY_PWT_RANGE_REPLAY_FROM_HEIGHT: 950200,
      NETWORK: "livenet",
      objectValue: (value) => value ?? {},
    },
  );
  assert.equal(
    legacyCompletedPwtRangeReplayCanBeReprepared(existingRebuild, 958383),
    true,
  );
  const prepareCanonicalPwtRangeReplay = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalPwtRangeReplay",
    {
      BLOCK_SCAN_FROM_HEIGHT: 958383,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 958700;
        if (method === "getblockhash") {
          if (Number(params[0]) === 947999) return canonicalBootstrapHash;
          if (Number(params[0]) === 958700) return "c".repeat(64);
          return rangeCheckpointHash;
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      assertCanonicalPwtRangeReplayState: () => {
        throw new Error("legacy completion must use the explicit migration gate");
      },
      assertCanonicalWorkAtomicProjection: async (_client, context) => {
        calls.push(`atomic-definition:${context}`);
        return true;
      },
      assertCanonicalWorkAtomicSource: async (_client, context) => {
        calls.push(`atomic-source:${context}`);
        return {
          audit: { atomic: true, legacy: false },
          conservation: {
            balanceSupply: "2100000000000000",
            mintedSupply: "2100000000000000",
            mintEvents: 21000,
          },
        };
      },
      assertCanonicalIncbRangeReplayWitnessManifestUnchanged: async (
        _client,
        manifest,
        metaKey,
      ) => {
        calls.push("verify-witness-manifest-unchanged");
        assert.equal(
          metaKey,
          incbRangeReplayWitnessMetaKey("livenet", manifest.bindingId),
        );
        return manifest;
      },
      canonicalIncbPwtRangeReplayTargets: (fromHeight) =>
        CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.filter(
          (target) => target.blockHeight >= fromHeight,
        ),
      captureCanonicalIncbRangeReplayWitnessManifest: async (
        _client,
        options,
      ) => {
        calls.push("capture-witness-manifest");
        return buildIncbRangeReplayWitnessManifest({
          ...options,
          entries: [],
          network: "livenet",
        });
      },
      incbRangeReplayWitnessBindingFields,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      legacyCompletedPwtRangeReplayCanBeReprepared,
      migrateUnboundedCreditUnitStorage: async () => {
        calls.push("migrate-credit-units");
        return { storageModel: "unconstrained-integer-numeric-v1" };
      },
      newPwtRangeReplayVerifierBinding: (rangeReplayFromHeight, createdAt) => ({
        bindingId: "f".repeat(64),
        createdAt,
        model: "proof-indexer-pwt-range-replay-verifier-binding-v1",
        network: "livenet",
        rangeReplayFromHeight,
      }),
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:rebuild" ? storedRebuildMeta : null,
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {
        calls.push("rebuild-balances");
        return { holders: 4, tokens: 3 };
      },
      seedCanonicalBondDefinitions: async () => calls.push("seed-bonds"),
      seedCanonicalWorkDefinition: async () => calls.push("seed-work"),
      sourceLabelForProtocolItem: (item) =>
        item.kind === "token-create" ? "tokens" : "token-listings",
      storeBlockScanSnapshot: async (_client, payload) =>
        calls.push({ snapshot: payload }),
      storeProofIndexerMeta: async (_client, key, value) => {
        if (key === "canonical:rebuild") {
          storedRebuildMeta = value;
        }
        calls.push({ key, meta: value });
      },
      upsertProjection: async (_client, source, item) =>
        calls.push({ item, source }),
      verifyCanonicalIncbPwtRangeReplayCoreFacts: async (targets) => {
        calls.push("verify-core");
        return targets.map(
          ({ blockHash, blockHeight, blockIndex, txid, workAmountAtoms }) => ({
            blockHash,
            blockHeight,
            blockIndex,
            txid,
            workAmountAtoms,
          }),
        );
      },
    },
  );
  const client = {
    async query(sql, params = []) {
      const normalizedSql = String(sql).trim();
      calls.push({ params: Array.from(params), sql: normalizedSql });
      if (normalizedSql.includes("AS first_height")) {
        return { rows: [{ first_height: 950246 }] };
      }
      if (normalizedSql.includes("AS first_false_height")) {
        return { rows: [{ first_false_height: null }] };
      }
      if (normalizedSql.includes("e.kind = 'token-create'")) {
        return {
          rows: [
            {
              payload: { kind: "token-create", tokenId: "d".repeat(64) },
              status: "confirmed",
            },
          ],
        };
      }
      if (
        normalizedSql.includes("SELECT e.payload, e.status") &&
        normalizedSql.includes("e.kind = ANY")
      ) {
        return {
          rows: [
            {
              payload: { kind: "token-listing", listingId: "e".repeat(64) },
              status: "confirmed",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const prepared = await prepareCanonicalPwtRangeReplay(client);
  assert.equal(prepared.resumed, false);
  assert.equal(prepared.value.fromHeight, 948000);
  assert.equal(prepared.value.bootstrapHeight, 947999);
  assert.equal(prepared.value.bootstrapHash, canonicalBootstrapHash);
  assert.equal(prepared.value.rangeReplayFromHeight, 958383);
  assert.equal(prepared.value.indexedThroughBlock, 958382);
  assert.equal(prepared.value.indexedThroughBlockHash, rangeCheckpointHash);
  assert.equal(prepared.value.verifierBinding.bindingId, "f".repeat(64));
  assert.equal(
    prepared.value.verifierBinding.witnessModel,
    INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
  );
  assert.equal(prepared.value.verifierBinding.witnessCount, 0);
  assert.ok(calls.includes("capture-witness-manifest"));
  assert.ok(calls.includes("verify-witness-manifest-unchanged"));
  assert.equal(
    Object.hasOwn(prepared.value, "completedAt"),
    false,
    "a new active range must not retain the prior rebuild completion time",
  );
  assert.equal(
    Object.hasOwn(prepared.value, "incbRangeReplayVerification"),
    false,
    "a new active range must not retain a prior replay verification proof",
  );
  assert.equal(
    prepared.value.verifierBinding.rangeReplayFromHeight,
    prepared.value.rangeReplayFromHeight,
  );
  assert.equal(prepared.firstMarketplaceHeight, 950246);
  assert.equal(prepared.pinnedIncbTargets.length, 4);
  assert.equal(calls[0].sql, "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.equal(calls.at(-1).sql, "COMMIT");
  const sql = calls.filter((call) => call.sql).map((call) => call.sql).join("\n");
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /LOCK TABLE[\s\S]*IN SHARE ROW EXCLUSIVE MODE/u);
  assert.match(sql, /WITH replay_txids AS[\s\S]*DELETE FROM proof_indexer\.events/u);
  assert.match(sql, /DELETE FROM proof_indexer\.credit_balances/u);
  assert.match(sql, /DELETE FROM proof_indexer\.credit_listings/u);
  assert.match(sql, /DELETE FROM proof_indexer\.credit_definitions/u);
  assert.match(sql, /DELETE FROM proof_indexer\.ledger_snapshots/u);
  assert.doesNotMatch(sql, /DELETE FROM proof_indexer\.(?:id_records|mail_items)/u);
  assert.ok(calls.includes("seed-work"));
  assert.ok(calls.includes("seed-bonds"));
  assert.ok(calls.includes("migrate-credit-units"));
  assert.ok(calls.includes("rebuild-balances"));
  assert.ok(
    calls.indexOf("atomic-source:PWT range replay source projection") <
      calls.findIndex((call) =>
        call.sql?.includes("WITH replay_txids AS"),
      ),
    "atomic source and conservation must pass before destructive replay deletes",
  );
  assert.ok(
    calls.includes("atomic-definition:PWT range replay retained definitions"),
  );
  assert.ok(calls.includes("atomic-source:PWT range replay retained state"));
  assert.ok(
    calls.includes("atomic-definition:PWT range replay pre-commit projection"),
  );
  assert.equal(
    calls.filter((call) => call === "verify-core").length,
    2,
    "immutable Core facts must be checked inside the lock and before commit",
  );
  assert.ok(
    calls.indexOf("rebuild-balances") <
      calls.findIndex((call) => call.sql === "COMMIT"),
  );
  assert.ok(calls.some((call) => call.source === "tokens"));
  assert.ok(calls.some((call) => call.source === "token-listings"));
});

check("completed INCB range replay verifies exact dynamic H-1 Q8 issuance", async () => {
  const incbTokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const accountingModel = "canonical-pre-bond-live-network-value-v2";
  const snapshotValues = [
    "3975162634405565000000000",
    "4175162634405565000000000",
    "4375162634405565000000000",
    "5200000000000000000000000",
  ];
  const canonicalIncbIssuanceQ8Projection = isolatedFunction(
    BACKFILL_PATH,
    "canonicalIncbIssuanceQ8Projection",
    {
      VALUE_Q8_SCALE,
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_UNIT_SCALE,
      canonicalIntegerText: (value, { positive = false } = {}) => {
        const text = String(value ?? "").trim();
        return (positive ? /^[1-9]\d*$/u : /^\d+$/u).test(text) ? text : "";
      },
      canonicalWorkAtomsText,
    },
  );
  const expectedByTxid = new Map();
  const rows = CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.flatMap(
    (target, index) => {
      const expected = canonicalIncbIssuanceQ8Projection({
        attachedWorkAmountAtoms: target.workAmountAtoms,
        directProofIssuanceUnits: String(target.bondRecipientAmountSats),
        workNetworkValueQ8: snapshotValues[index],
      });
      expectedByTxid.set(target.txid, expected);
      const transaction = {
        status: "confirmed",
        transaction_block_hash: target.blockHash,
        transaction_block_height: target.blockHeight,
        transaction_status: "confirmed",
        txid: target.txid,
        valid: true,
      };
      return [
        {
          ...transaction,
          kind: "inception-bond",
          payload: {
            attachedCredits: [
              {
                amountAtoms: target.workAmountAtoms,
                protocolVout: target.workProtocolVout,
                recipientAddress: target.bondRecipientAddress,
                tokenId: WORK_TOKEN_ID,
              },
            ],
            kind: "inception-bond",
            txid: target.txid,
          },
          protocol: "pwm1",
        },
        {
          ...transaction,
          kind: "token-transfer",
          payload: {
            amountAtoms: target.workAmountAtoms,
            kind: "token-transfer",
            protocolVout: target.workProtocolVout,
            recipientAddress: target.bondRecipientAddress,
            senderAddress: target.bondRecipientAddress,
            tokenId: WORK_TOKEN_ID,
            transferVersion: "send2",
            txid: target.txid,
          },
          protocol: "pwt1",
        },
        {
          ...transaction,
          kind: "token-mint",
          payload: {
            amount: expected.confirmedIssuanceUnits,
            amountSats: 0,
            attachedWorkAmountAtoms: target.workAmountAtoms,
            attachedWorkIssuanceUnits:
              expected.attachedWorkIssuanceUnits,
            attachedWorkLiveValueAtSendQ8:
              expected.attachedWorkLiveValueAtSendQ8,
            bondRecipientAddress: target.bondRecipientAddress,
            bondRecipientAmountSats: String(
              target.bondRecipientAmountSats,
            ),
            bondRecipientVout: target.bondRecipientVout,
            confirmed: true,
            confirmedIssuanceUnits: expected.confirmedIssuanceUnits,
            issuanceAccountingModel: accountingModel,
            issuanceAmount: expected.confirmedIssuanceUnits,
            issuanceDustQ8: expected.issuanceDustQ8,
            issuanceNetworkValueQ8: expected.issuanceNetworkValueQ8,
            issuanceValueSnapshotBlockHeight: target.blockHeight - 1,
            issuanceValueSnapshotWorkNetworkValueQ8: snapshotValues[index],
            kind: "token-mint",
            minterAddress: target.bondRecipientAddress,
            protocol: "pwt1",
            sourceBondTxid: target.txid,
            ticker: "INCB",
            tokenId: incbTokenId,
            txid: target.txid,
            validationMode: "canonical-incb-bond-projection",
          },
          protocol: "pwt1",
        },
      ];
    },
  );
  const verifyCanonicalIncbPwtRangeReplayProjection = isolatedFunction(
    BACKFILL_PATH,
    "verifyCanonicalIncbPwtRangeReplayProjection",
    {
      INCB_ISSUANCE_ACCOUNTING_MODEL: accountingModel,
      INCB_TOKEN_ID: incbTokenId,
      INCEPTION_BOND_KIND: "inception-bond",
      NETWORK: "livenet",
      WORK_TOKEN_ID,
      canonicalBondMintProjection: (item) =>
        item?.validationMode === "canonical-incb-bond-projection",
      canonicalIncbIssuanceQ8Projection,
      canonicalIncbPwtRangeReplayTargets: (fromHeight) =>
        CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.filter(
          (target) => target.blockHeight >= fromHeight,
        ),
      canonicalIncbRangeReplayCompletionWitnesses: async () => ({
        binding: replayVerifierBindingFixture({
          witnessCount: CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.length,
          witnessPreserveCount: 0,
        }),
        manifest: {
          commitment: { hash: "d".repeat(64) },
          count: CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.length,
          preserveCount: 0,
          throughHash: "e".repeat(64),
          throughHeight: 958_700,
        },
        preservedWitnesses: [],
        rederivedWitnesses: CANONICAL_INCB_PWT_RANGE_REPLAY_FIXTURE.map(
          (target) => ({
            bondRecipientVout: target.bondRecipientVout,
            disposition: "mint",
            identity: `${target.txid}:${target.bondRecipientVout}`,
            mintPayloadHash: canonicalIncbReplaySha256(
              rows.find(
                (row) =>
                  row.txid === target.txid && row.kind === "token-mint",
              )?.payload ?? {},
            ),
            snapshotFingerprint: "f".repeat(64),
            snapshotId: `rederived-${target.txid}`,
            txid: target.txid,
          }),
        ).sort((left, right) => left.identity.localeCompare(right.identity)),
      }),
      incbIssuanceMetadataInvalidReason: () => "",
      verifyCanonicalIncbPwtRangeReplayCoreFacts: async (targets) =>
        targets.map((target) => ({
          blockHeight: target.blockHeight,
          txid: target.txid,
        })),
    },
  );
  const client = {
    async query() {
      return { rows };
    },
  };
  const rebuild = {
    mode: "pwt-range-replay",
    rangeReplayFromHeight: 958383,
  };
  const verified = JSON.parse(
    JSON.stringify(
      await verifyCanonicalIncbPwtRangeReplayProjection(client, rebuild),
    ),
  );
  assert.equal(verified.verified, true);
  assert.equal(verified.targets.length, 4);
  const downstreamTxid =
    "62f1a62fdf984c3c50b067cfed806023ad61d4fabd62087ecdd891554f5b51d6";
  const downstream = verified.targets.find(
    (target) => target.txid === downstreamTxid,
  );
  assert.equal(
    downstream.confirmedIssuanceUnits,
    expectedByTxid.get(downstreamTxid).confirmedIssuanceUnits,
  );
  assert.notEqual(
    downstream.confirmedIssuanceUnits,
    "6766218966751648",
    "the downstream bond must be recomputed from replay H-1, not pinned",
  );

  rows.push({
    ...rows[0],
    kind: "token-event-invalid",
    protocol: "pwt1",
    valid: false,
  });
  await rejection(
    verifyCanonicalIncbPwtRangeReplayProjection(client, rebuild),
    (error) => /invalid alias or noncanonical sibling/u.test(error.message),
  );
});

check("completed canonical metadata advances through H+1 and H+2 catch-up", () => {
  const canonicalRebuildCheckpointValue = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRebuildCheckpointValue",
  );
  const completedAtH = {
    active: false,
    bootstrapHash: "a".repeat(64),
    bootstrapHeight: 99,
    complete: true,
    fromHeight: 100,
    indexedThroughBlock: 110,
    indexedThroughBlockHash: "b".repeat(64),
    network: "livenet",
    status: "complete",
  };
  const atH1 = canonicalRebuildCheckpointValue(completedAtH, {
    blockHash: "c".repeat(64),
    complete: false,
    height: 111,
  });
  assert.equal(atH1.status, "active");
  assert.equal(atH1.indexedThroughBlock, 111);
  const atH2 = canonicalRebuildCheckpointValue(atH1, {
    blockHash: "d".repeat(64),
    complete: true,
    height: 112,
  });
  assert.equal(atH2.status, "complete");
  assert.equal(atH2.indexedThroughBlock, 112);
  assert.equal(atH2.indexedThroughBlockHash, "d".repeat(64));
});

check("completed PWT replay certificates stay complete during later catch-up", () => {
  const canonicalRebuildCheckpointValue = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRebuildCheckpointValue",
    { canonicalPwtRangeReplayState: () => "complete" },
  );
  const certificate = {
    accountingModel: "incb-pre-bond-live-work-network-value-v1",
    targets: [{ txid: "1".repeat(64) }],
    verified: true,
  };
  const verifierBinding = {
    bindingId: "2".repeat(64),
    model: "proof-indexer-pwt-range-replay-verifier-binding-v1",
  };
  const completedReplay = {
    active: false,
    complete: true,
    completedAt: "2026-07-18T20:00:00.000Z",
    incbRangeReplayVerification: certificate,
    indexedThroughBlock: 110,
    indexedThroughBlockHash: "a".repeat(64),
    mode: "pwt-range-replay",
    network: "livenet",
    status: "complete",
    verifierBinding,
  };

  const atH1 = canonicalRebuildCheckpointValue(completedReplay, {
    blockHash: "b".repeat(64),
    complete: false,
    height: 111,
  });
  const atH2 = canonicalRebuildCheckpointValue(atH1, {
    blockHash: "c".repeat(64),
    complete: true,
    height: 112,
  });

  for (const [height, blockHash, state] of [
    [111, "b".repeat(64), atH1],
    [112, "c".repeat(64), atH2],
  ]) {
    assert.equal(state.status, "complete");
    assert.equal(state.active, false);
    assert.equal(state.complete, true);
    assert.equal(state.completedAt, completedReplay.completedAt);
    assert.equal(state.indexedThroughBlock, height);
    assert.equal(state.indexedThroughBlockHash, blockHash);
    assert.deepEqual(state.incbRangeReplayVerification, certificate);
    assert.deepEqual(state.verifierBinding, verifierBinding);
  }
});

check("ordinary catch-up never reopens a completed PWT replay", async () => {
  const hashes = {
    110: "a".repeat(64),
    111: "b".repeat(64),
    112: "c".repeat(64),
  };
  const certificate = {
    accountingModel: "incb-pre-bond-live-work-network-value-v1",
    coreFacts: [{ txid: "1".repeat(64) }],
    targets: [{ txid: "1".repeat(64) }],
    verified: true,
  };
  const completedReplay = {
    active: false,
    complete: true,
    completedAt: "2026-07-18T20:00:00.000Z",
    incbRangeReplayVerification: certificate,
    indexedThroughBlock: 110,
    indexedThroughBlockHash: hashes[110],
    mode: "pwt-range-replay",
    network: "livenet",
    status: "complete",
    verifierBinding: {
      bindingId: "2".repeat(64),
      model: "proof-indexer-pwt-range-replay-verifier-binding-v1",
    },
  };
  const replayState = (rebuild) =>
    rebuild?.mode === "pwt-range-replay" &&
    rebuild?.status === "complete" &&
    rebuild?.active === false &&
    rebuild?.complete === true
      ? "complete"
      : null;
  const checkpointValue = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRebuildCheckpointValue",
    { canonicalPwtRangeReplayState: replayState },
  );
  const storedMeta = [];
  const snapshots = [];
  let balanceRebuilds = 0;
  let certificateReplacements = 0;
  let definitionSeeds = 0;
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      BLOCK_SCAN_MAX_BLOCKS: 0,
      BLOCK_SCAN_MAX_TXIDS: Number.POSITIVE_INFINITY,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD: false,
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      STORE_CANONICAL_SUMMARY_SNAPSHOT: true,
      activePwtRangeReplay: () => false,
      assertCanonicalBlockEnvelope: () => {},
      assertCanonicalPwtRangeReplayState: replayState,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 112;
        if (method === "getblockhash") return hashes[Number(params[0])];
        if (method === "getblock") {
          const height = Number(
            Object.entries(hashes).find(([, hash]) => hash === params[0])?.[0],
          );
          return {
            hash: hashes[height],
            height,
            nTx: 0,
            previousblockhash: hashes[height - 1],
            time: 1_700_000_000 + height,
            tx: [],
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      canonicalRebuildCheckpointValue: checkpointValue,
      latestBlockScanCheckpoint: async () => ({
        blockHash: hashes[110],
        height: 110,
      }),
      persistCanonicalBlock: async () => {},
      proofIndexerMetaValue: async (_client, key) =>
        key === "canonical:rebuild" ? completedReplay : null,
      protocolMessagesFromTx: () => [],
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {
        balanceRebuilds += 1;
      },
      seedCanonicalBondDefinitions: async () => {
        definitionSeeds += 1;
      },
      storeBlockScanSnapshot: async (_client, payload) => {
        snapshots.push(payload);
      },
      storeProofIndexerMeta: async (_client, key, value) => {
        assert.equal(key, "canonical:rebuild");
        storedMeta.push(value);
      },
      verifyCanonicalIncbPwtRangeReplayProjection: async () => {
        certificateReplacements += 1;
        throw new Error("a completed replay certificate must not be replaced");
      },
    },
  );
  const client = {
    async query() {
      return { rows: [] };
    },
  };

  const result = await backfillBlockScanSource(client, {
    label: "block-scan",
  });
  assert.equal(result.complete, true);
  assert.equal(result.indexedThroughBlock, 112);
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.indexedThroughBlock),
    [111, 112],
  );
  assert.equal(storedMeta.length, 2);
  assert.equal(balanceRebuilds, 0);
  assert.equal(definitionSeeds, 0);
  assert.equal(certificateReplacements, 0);
  for (const [index, state] of storedMeta.entries()) {
    assert.equal(replayState(state), "complete");
    assert.equal(state.completedAt, completedReplay.completedAt);
    assert.equal(state.indexedThroughBlock, 111 + index);
    assert.equal(state.indexedThroughBlockHash, hashes[111 + index]);
    assert.deepEqual(state.incbRangeReplayVerification, certificate);
    assert.deepEqual(state.verifierBinding, completedReplay.verifierBinding);
    assert.deepEqual(snapshots[index].rebuild, state);
  }
});

check("canonical transaction detail rows preserve full-node input and output truth", () => {
  const satsFromVoutValue = isolatedFunction(
    BACKFILL_PATH,
    "satsFromVoutValue",
  );
  const prevoutFromOutput = isolatedFunction(
    BACKFILL_PATH,
    "prevoutFromOutput",
    { satsFromVoutValue },
  );
  const addressFromVout = isolatedFunction(BACKFILL_PATH, "addressFromVout");
  const canonicalOpReturnPayloadFromVout = isolatedFunction(
    BACKFILL_PATH,
    "canonicalOpReturnPayloadFromVout",
    { Buffer },
  );
  const canonicalTransactionDetailRows = isolatedFunction(
    BACKFILL_PATH,
    "canonicalTransactionDetailRows",
    {
      PROTOCOL_PREFIXES: ["pwm1:", "pwid1:", "pwt1:"],
      addressFromVout,
      canonicalOpReturnPayloadFromVout,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      prevoutFromOutput,
    },
  );
  const payload = Buffer.from("pwm1:b:POWB:100", "utf8");
  const opReturnScript = Buffer.concat([
    Buffer.from([0x6a, payload.length]),
    payload,
  ]).toString("hex");
  const rows = canonicalTransactionDetailRows({
    txid: "a".repeat(64),
    vin: [
      {
        prevout: {
          scriptPubKey: {
            address: "bc1psender",
            asm: "1 sender",
            hex: "5120" + "1".repeat(64),
            type: "witness_v1_taproot",
          },
          value: 0.001,
          valueSats: 100_000,
        },
        scriptSig: { hex: "" },
        sequence: 4_294_967_293,
        txid: "b".repeat(64),
        txinwitness: ["aa", "bb"],
        vout: 2,
      },
    ],
    vout: [
      {
        n: 0,
        scriptPubKey: {
          address: "bc1preceiver",
          asm: "1 receiver",
          hex: "5120" + "2".repeat(64),
          type: "witness_v1_taproot",
        },
        value: 0.00000546,
      },
      {
        n: 1,
        scriptPubKey: {
          asm: `OP_RETURN ${payload.toString("hex")}`,
          hex: opReturnScript,
          type: "nulldata",
        },
        value: 0,
      },
    ],
  });
  assert.equal(rows.inputs.length, 1);
  assert.equal(rows.inputs[0].prev_txid, "b".repeat(64));
  assert.equal(rows.inputs[0].prev_vout, 2);
  assert.equal(rows.inputs[0].address, "bc1psender");
  assert.equal(rows.inputs[0].value_sats, 100_000);
  assert.equal(rows.inputs[0].sequence, 4_294_967_293);
  assert.deepEqual(Array.from(rows.inputs[0].witness), ["aa", "bb"]);
  assert.equal(rows.outputs[0].value_sats, 546);
  assert.equal(rows.outputs[0].address, "bc1preceiver");
  assert.equal(rows.outputs[0].scriptpubkey_type, "witness_v1_taproot");
  assert.equal(rows.opReturns.length, 1);
  assert.equal(rows.opReturns[0].vout, 1);
  assert.equal(rows.opReturns[0].protocol, "pwm1");
  assert.equal(rows.opReturns[0].payload_text, "pwm1:b:POWB:100");
  assert.equal(rows.opReturns[0].payload_hex, payload.toString("hex"));
  assert.equal(rows.opReturns[0].data_bytes, payload.length);
  assert.equal(
    canonicalOpReturnPayloadFromVout({
      scriptPubKey: { hex: "6a4c02ff" },
    }),
    null,
  );
  const binaryPayload = canonicalOpReturnPayloadFromVout({
    scriptPubKey: { hex: "6a02fffe" },
  });
  assert.equal(binaryPayload.payloadText, null);
  assert.equal(binaryPayload.payloadHex, "fffe");
  assert.throws(
    () =>
      canonicalTransactionDetailRows({
        txid: "a".repeat(64),
        vin: [{ coinbase: "00", sequence: 4_294_967_295 }],
        vout: [{ n: 1, scriptPubKey: { hex: "00" }, value: 0 }],
      }),
    /mismatched index/u,
  );
});

check("canonical transaction-row repair proves exact Core membership and index", async () => {
  const txid = "2".repeat(64);
  const blockHash = "3".repeat(64);
  const previousBlockHash = "4".repeat(64);
  const calls = [];
  let hydrated = false;
  const canonicalTransactionRepairTarget = isolatedFunction(
    BACKFILL_PATH,
    "canonicalTransactionRepairTarget",
    {
      assertCanonicalBlockEnvelope: () => {},
      assertHydratedProtocolTransaction: (tx) => {
        hydrated = true;
        assert.equal(tx._powBlockIndex, 1);
        assert.equal(tx._powBlockHash, blockHash);
      },
      bitcoinRpc: async (method, params) => {
        calls.push([method, params]);
        if (method === "getrawtransaction") {
          return {
            blockhash: blockHash,
            confirmations: 10,
            hash: txid,
            hex: "deadbeef",
            txid,
          };
        }
        if (method === "getblock") {
          return {
            hash: blockHash,
            height: 123,
            nTx: 2,
            previousblockhash: previousBlockHash,
            time: 1_700_000_000,
            tx: [
              { hash: "1".repeat(64), txid: "1".repeat(64) },
              { hash: txid, hex: "deadbeef", txid, vin: [{}], vout: [{}] },
            ],
          };
        }
        if (method === "getblockhash") return blockHash;
        throw new Error(`unexpected RPC ${method}`);
      },
      canonicalTransactionDetailRows: (tx) => ({
        inputs: [{ vin: tx._powBlockIndex }],
        opReturns: [],
        outputs: [],
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      transactionWithInputPrevouts: async (tx) => ({ ...tx, hydrated: true }),
    },
  );
  const target = await canonicalTransactionRepairTarget(txid);
  assert.equal(hydrated, true);
  assert.equal(target.blockHash, blockHash);
  assert.equal(target.height, 123);
  assert.equal(target.blockIndex, 1);
  assert.equal(target.hydrated._powPreviousBlockHash, previousBlockHash);
  assert.deepEqual(
    Array.from(calls, ([method]) => method),
    ["getrawtransaction", "getblock", "getblockhash"],
  );
});

check("canonical transaction-row repair rejects a non-canonical block", async () => {
  const txid = "5".repeat(64);
  const blockHash = "6".repeat(64);
  const canonicalTransactionRepairTarget = isolatedFunction(
    BACKFILL_PATH,
    "canonicalTransactionRepairTarget",
    {
      assertCanonicalBlockEnvelope: () => {},
      assertHydratedProtocolTransaction: () => {},
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction") {
          return { blockhash: blockHash, confirmations: 1, txid };
        }
        if (method === "getblock") {
          return {
            hash: blockHash,
            height: 456,
            nTx: 1,
            tx: [{ txid, vin: [{}], vout: [{}] }],
          };
        }
        if (method === "getblockhash") return "7".repeat(64);
        throw new Error(`unexpected RPC ${method}`);
      },
      canonicalTransactionDetailRows: () => ({
        inputs: [],
        opReturns: [],
        outputs: [],
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      transactionWithInputPrevouts: async (tx) => tx,
    },
  );
  await rejection(
    canonicalTransactionRepairTarget(txid),
    (error) => /not in the canonical block/u.test(error.message),
    "A stale block membership must fail closed",
  );
});

check("canonical transaction-row repair rejects non-confirmed locked rows before persistence", async () => {
  const txid = "8".repeat(64);
  const target = {
    block: { time: 1_700_000_000 },
    blockHash: "9".repeat(64),
    blockIndex: 0,
    details: { inputs: [], opReturns: [], outputs: [] },
    height: 789,
    hydrated: { txid },
    txid,
  };
  let lockedStatus = "pending";
  let persistenceCalls = 0;
  let eventStateReads = 0;
  let finalCoreProofs = 0;
  let statements = [];
  const repairCanonicalTransactions = isolatedFunction(
    BACKFILL_PATH,
    "repairCanonicalTransactions",
    {
      NETWORK: "livenet",
      REPAIR_CANONICAL_TXIDS: [txid],
      assertCanonicalTransactionRepairStillCurrent: async () => {
        finalCoreProofs += 1;
      },
      canonicalTransactionRepairDetailsFingerprint: () => "exact",
      canonicalTransactionRepairEventState: async () => {
        eventStateReads += 1;
        return { count: 0, fingerprint: "empty" };
      },
      canonicalTransactionRepairTarget: async () => target,
      persistCanonicalBlock: async () => {
        persistenceCalls += 1;
      },
      persistCanonicalRawTransaction: async () => {
        persistenceCalls += 1;
      },
      storedCanonicalTransactionRepairDetails: async () => target.details,
    },
  );
  const client = {
    async query(sql) {
      const text = String(sql).trim();
      statements.push(text);
      if (/SELECT txid, status/u.test(text)) {
        return { rows: [{ status: lockedStatus, txid }] };
      }
      return { rows: [] };
    },
  };

  for (const status of ["pending", "dropped", "orphaned"]) {
    lockedStatus = status;
    statements = [];
    await rejection(
      repairCanonicalTransactions(client),
      (error) => /requires every target row to already be confirmed/u.test(
        error.message,
      ),
      `${status} transaction rows must fail closed`,
    );
    assert.equal(statements[0], "BEGIN");
    assert.match(statements[1], /SELECT txid, status/u);
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.equal(statements.includes("COMMIT"), false);
    assert.equal(persistenceCalls, 0);
    assert.equal(eventStateReads, 0);
    assert.equal(finalCoreProofs, 0);
  }
});

check("canonical transaction-row repair is atomic and preserves event rows", async () => {
  const txid = "8".repeat(64);
  const blockHash = "9".repeat(64);
  const details = { inputs: [], opReturns: [], outputs: [] };
  const target = {
    block: { time: 1_700_000_000 },
    blockHash,
    blockIndex: 4,
    details,
    height: 789,
    hydrated: {
      _powBlockHash: blockHash,
      _powBlockIndex: 4,
      canonicalBlockScan: {
        blockHash,
        height: 789,
        network: "livenet",
      },
      txid,
    },
    txid,
  };
  const events = [];
  let eventReads = 0;
  const client = {
    async query(sql) {
      const text = String(sql).trim();
      events.push(text);
      if (/SELECT txid, status/u.test(text)) {
        return { rows: [{ status: "confirmed", txid }] };
      }
      if (/transaction_row\.status/u.test(text)) {
        return {
          rows: [{
            block_canonical: true,
            block_hash: blockHash,
            block_height: 789,
            canonical_block_count: "1",
            raw_tx: target.hydrated,
            source: "canonical-block-scan",
            status: "confirmed",
          }],
        };
      }
      return { rows: [] };
    },
  };
  const repairCanonicalTransactions = isolatedFunction(
    BACKFILL_PATH,
    "repairCanonicalTransactions",
    {
      NETWORK: "livenet",
      REPAIR_CANONICAL_TXIDS: [txid],
      assertCanonicalTransactionRepairStillCurrent: async () => {
        events.push("core-final");
      },
      canonicalTransactionRepairDetailsFingerprint: () => "exact",
      canonicalTransactionRepairEventState: async () => {
        eventReads += 1;
        return { count: 2, fingerprint: "unchanged" };
      },
      canonicalTransactionRepairTarget: async () => target,
      persistCanonicalBlock: async () => {
        events.push("persist-block");
      },
      persistCanonicalRawTransaction: async () => {
        events.push("persist-raw-and-details");
      },
      storedCanonicalTransactionRepairDetails: async () => details,
    },
  );
  const result = await repairCanonicalTransactions(client);
  assert.equal(result.repaired, 1);
  assert.equal(result.eventRowsPreserved, 2);
  assert.equal(eventReads, 2);
  assert.ok(events.includes("persist-block"));
  assert.ok(events.includes("persist-raw-and-details"));
  assert.ok(events.includes("core-final"));
  assert.equal(events.at(-1), "COMMIT");
  const source = topLevelFunctionSource(
    BACKFILL_PATH,
    "repairCanonicalTransactions",
  );
  assert.doesNotMatch(
    source,
    /(?:INSERT INTO|UPDATE|DELETE FROM) proof_indexer\.events/u,
  );

  const rollbackEvents = [];
  const rollbackClient = {
    async query(sql) {
      const text = String(sql).trim();
      rollbackEvents.push(text);
      if (/SELECT txid, status/u.test(text)) {
        return { rows: [{ status: "confirmed", txid }] };
      }
      if (/transaction_row\.status/u.test(text)) {
        return {
          rows: [{
            block_canonical: true,
            block_hash: blockHash,
            block_height: 789,
            canonical_block_count: "1",
            raw_tx: target.hydrated,
            source: "canonical-block-scan",
            status: "confirmed",
          }],
        };
      }
      return { rows: [] };
    },
  };
  const reorgingRepair = isolatedFunction(
    BACKFILL_PATH,
    "repairCanonicalTransactions",
    {
      NETWORK: "livenet",
      REPAIR_CANONICAL_TXIDS: [txid],
      assertCanonicalTransactionRepairStillCurrent: async () => {
        throw new Error("reorg before commit");
      },
      canonicalTransactionRepairDetailsFingerprint: () => "exact",
      canonicalTransactionRepairEventState: async () => ({
        count: 2,
        fingerprint: "unchanged",
      }),
      canonicalTransactionRepairTarget: async () => target,
      persistCanonicalBlock: async () => {},
      persistCanonicalRawTransaction: async () => {},
      storedCanonicalTransactionRepairDetails: async () => details,
    },
  );
  await rejection(
    reorgingRepair(rollbackClient),
    (error) => /reorg before commit/u.test(error.message),
  );
  assert.equal(rollbackEvents.at(-1), "ROLLBACK");
  assert.equal(rollbackEvents.includes("COMMIT"), false);
});

check("canonical raw tx replaces legacy wrappers without entering event payloads", async () => {
  const txid = "b".repeat(64);
  const calls = [];
  const details = {
    inputs: [
      {
        address: "sender",
        prev_txid: "a".repeat(64),
        prev_vout: 0,
        script_sig: null,
        sequence: 1,
        value_sats: 10_000,
        vin: 0,
        witness: ["aa"],
      },
    ],
    opReturns: [
      {
        data_bytes: 6,
        output_index: 0,
        payload_hex: "70776d313a78",
        payload_text: "pwm1:x",
        protocol: "pwm1",
        vout: 1,
      },
    ],
    outputs: [
      {
        address: "receiver",
        scriptpubkey: "51",
        scriptpubkey_asm: "1",
        scriptpubkey_type: "nonstandard",
        value_sats: 546,
        vout: 0,
      },
      {
        address: null,
        scriptpubkey: "6a0670776d313a78",
        scriptpubkey_asm: "OP_RETURN 70776d313a78",
        scriptpubkey_type: "nulldata",
        value_sats: 0,
        vout: 1,
      },
    ],
  };
  const canonicalTransactionDetailRows = () => details;
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const persistCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows,
      isHexTxid,
    },
  );
  const persistCanonicalRawTransaction = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalRawTransaction",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows,
      isHexTxid,
      itemTime: () => null,
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
      persistCanonicalTransactionDetails,
    },
  );
  await persistCanonicalRawTransaction(
    {
      async query(sql, params) {
        calls.push({ params: Array.from(params), sql: String(sql) });
        return { rows: [] };
      },
    },
    {
      _powBlockIndex: 7,
      txid,
      vin: [{ prevout: { scriptPubKey: { address: "sender" }, value: 0.1 } }],
      vout: [{ scriptPubKey: { type: "nulldata" }, value: 0 }],
    },
    { blockHash: "c".repeat(64), blockTime: 1_700_000_000, height: 101 },
  );
  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /raw_tx = EXCLUDED\.raw_tx/u);
  assert.match(calls[0].sql, /fee_sats = EXCLUDED\.fee_sats/u);
  assert.equal(calls[0].params[5], 9_454);
  const raw = JSON.parse(calls[0].params[10]);
  assert.equal(raw.canonicalBlockScan.height, 101);
  assert.equal(raw.canonicalBlockScan.network, "livenet");
  assert.equal(raw._powBlockIndex, 7);
  assert.equal(raw.item, undefined);
  assert.equal(raw.vin.length, 1);
  assert.equal(raw.vout.length, 1);
  assert.match(calls[1].sql, /INSERT INTO proof_indexer\.tx_inputs/u);
  assert.match(calls[1].sql, /ON CONFLICT \(network, txid, vin\)/u);
  assert.equal(JSON.parse(calls[1].params[2])[0].value_sats, 10_000);
  assert.match(calls[2].sql, /INSERT INTO proof_indexer\.tx_outputs/u);
  assert.match(calls[2].sql, /scriptpubkey_asm = EXCLUDED\.scriptpubkey_asm/u);
  assert.doesNotMatch(calls[2].sql, /spent_by_txid = EXCLUDED/u);
  assert.match(calls[3].sql, /INSERT INTO proof_indexer\.op_returns/u);
  assert.match(
    calls[3].sql,
    /ON CONFLICT \(network, txid, vout, output_index\)/u,
  );
  assert.match(calls[4].sql, /FOR UPDATE OF spent_output/u);
  assert.equal(calls[4].params.length, 2);
  assert.equal(JSON.parse(calls[4].params[1])[0].prev_txid, "a".repeat(64));
  assert.match(calls[5].sql, /UPDATE proof_indexer\.tx_outputs AS spent_output/u);
  assert.match(
    calls[5].sql,
    /spent_by_txid IS NULL[\s\S]*spent_by_vin IS NOT DISTINCT FROM incoming\.vin/u,
  );
  assert.equal(calls[5].params[1], txid);
});

check("canonical coinbase protocol rows persist without inventing a miner fee", async () => {
  const txid = "e".repeat(64);
  const calls = [];
  const persistCanonicalRawTransaction = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalRawTransaction",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows: () => ({
        inputs: [
          {
            prev_txid: null,
            value_sats: null,
            vin: 0,
          },
        ],
        opReturns: [{ vout: 1 }],
        outputs: [
          { value_sats: 3_125_000_000, vout: 0 },
          { value_sats: 0, vout: 1 },
        ],
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      itemTime: () => "2026-07-14T00:00:00.000Z",
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
      persistCanonicalTransactionDetails: async () => {},
    },
  );
  await persistCanonicalRawTransaction(
    {
      async query(sql, params) {
        calls.push({ params: Array.from(params), sql: String(sql) });
        return { rows: [] };
      },
    },
    {
      txid,
      vin: [{ coinbase: "00" }],
      vout: [{ value: 31.25 }, { value: 0 }],
    },
    { blockHash: "f".repeat(64), blockTime: 1_700_000_000, height: 102 },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[5], null);
  assert.match(calls[0].sql, /fee_sats = EXCLUDED\.fee_sats/u);
});

check("canonical spend links reject conflicts and permit idempotent replays", async () => {
  const txid = "b".repeat(64);
  const parentTxid = "a".repeat(64);
  const details = {
    inputs: [
      {
        address: "sender",
        prev_txid: parentTxid,
        prev_vout: 1,
        script_sig: null,
        sequence: 1,
        value_sats: 10_000,
        vin: 0,
        witness: [],
      },
    ],
    opReturns: [],
    outputs: [],
  };
  const persistCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows: () => details,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
    },
  );
  const run = async (lockedRows) => {
    let updates = 0;
    const client = {
      async query(sql) {
        const text = String(sql);
        if (text.includes("FOR UPDATE OF spent_output")) {
          return { rows: lockedRows };
        }
        if (text.includes("UPDATE proof_indexer.tx_outputs AS spent_output")) {
          updates += 1;
        }
        return { rows: [] };
      },
    };
    const operation = persistCanonicalTransactionDetails(
      client,
      { txid },
      { details, spentAt: "2026-07-13T00:00:00.000Z" },
    );
    return { operation, updates: () => updates };
  };

  const idempotent = await run([
    {
      incoming_vin: 0,
      prev_txid: parentTxid,
      prev_vout: 1,
      spent_by_txid: txid,
      spent_by_vin: 0,
    },
  ]);
  await idempotent.operation;
  assert.equal(idempotent.updates(), 1);

  for (const conflict of [
    {
      incoming_vin: 0,
      prev_txid: parentTxid,
      prev_vout: 1,
      spent_by_txid: "c".repeat(64),
      spent_by_vin: 0,
    },
    {
      incoming_vin: 0,
      prev_txid: parentTxid,
      prev_vout: 1,
      spent_by_txid: txid,
      spent_by_vin: 2,
    },
  ]) {
    const rejected = await run([conflict]);
    await assert.rejects(rejected.operation, /Canonical spend-link conflict/u);
    assert.equal(rejected.updates(), 0);
  }
});

check("historical transaction detail hydration is bounded and projection-neutral", async () => {
  const firstTxid = "1".repeat(64);
  const secondTxid = "2".repeat(64);
  const persisted = [];
  const hydrateHistoricalCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "hydrateHistoricalCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX: -1,
      TX_DETAIL_HYDRATION_AFTER_HEIGHT: -1,
      TX_DETAIL_HYDRATION_AFTER_TXID: "",
      TX_DETAIL_HYDRATION_BATCH_SIZE: 2,
      TX_DETAIL_HYDRATION_MAX_ROWS: 2,
      assertHydratedProtocolTransaction: () => {},
      canonicalTransactionDetailRows: (tx) => ({
        inputs: [{ vin: 0 }],
        opReturns: [{ vout: 1 }],
        outputs: [{ vout: 0 }, { vout: 1 }],
        txid: tx.txid,
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      itemTime: () => "2026-07-13T00:00:00.000Z",
      persistCanonicalTransactionDetails: async (_client, tx, options) => {
        persisted.push({ options, txid: tx.txid });
        return { inputs: 1, opReturns: 1, outputs: 2 };
      },
      protocolMessagesFromTx: () => [{ prefix: "pwm1:" }],
    },
  );
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql).trim();
      calls.push({ params: Array.from(params), sql: text });
      if (text.startsWith("WITH candidates AS")) {
        return {
          rows: [
            {
              block_canonical: true,
              block_hash: "a".repeat(64),
              block_height: 100,
              block_index: 3,
              block_time: "2026-07-13T00:00:00.000Z",
              canonical_block_hash: "a".repeat(64),
              raw_tx: {
                _powBlockIndex: 3,
                canonicalBlockScan: {
                  blockHash: "a".repeat(64),
                  height: 100,
                  network: "livenet",
                },
                txid: firstTxid,
              },
              txid: firstTxid,
            },
            {
              block_canonical: true,
              block_hash: "a".repeat(64),
              block_height: 100,
              block_index: 4,
              block_time: "2026-07-13T00:01:00.000Z",
              canonical_block_hash: "a".repeat(64),
              raw_tx: {
                _powBlockIndex: 4,
                canonicalBlockScan: {
                  blockHash: "a".repeat(64),
                  height: 100,
                  network: "livenet",
                },
                txid: secondTxid,
              },
              txid: secondTxid,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const result = await hydrateHistoricalCanonicalTransactionDetails(client);
  assert.equal(result.hydrated, 2);
  assert.equal(result.inputs, 2);
  assert.equal(result.outputs, 4);
  assert.equal(result.opReturns, 2);
  assert.equal(result.batches, 1);
  assert.equal(result.limitReached, true);
  assert.equal(result.cursor.afterHeight, 100);
  assert.equal(result.cursor.afterBlockIndex, 4);
  assert.equal(result.cursor.afterTxid, secondTxid);
  assert.deepEqual(
    persisted.map((entry) => entry.txid),
    [firstTxid, secondTxid],
  );
  assert.deepEqual(
    calls.map((call) => call.sql === "BEGIN" || call.sql === "COMMIT"
      ? call.sql
      : "SELECT"),
    ["SELECT", "BEGIN", "COMMIT"],
  );
  assert.deepEqual(calls[0].params, ["livenet", -1, -1, "", 2]);
  assert.match(
    calls[0].sql,
    /JOIN proof_indexer\.blocks AS canonical_block[\s\S]*canonical_block\.block_hash = transaction_row\.block_hash[\s\S]*canonical_block\.height = transaction_row\.block_height[\s\S]*canonical_block\.canonical = true/u,
  );
  assert.match(
    calls[0].sql,
    /jsonb_typeof\(transaction_row\.raw_tx->'vin'\) = 'array'/u,
  );
  assert.match(
    calls[0].sql,
    /canonicalBlockScan'->>'height'[\s\S]*transaction_row\.block_height[\s\S]*canonicalBlockScan'->>'blockHash'[\s\S]*transaction_row\.block_hash/u,
  );
  assert.match(
    calls[0].sql,
    /ORDER BY block_height, block_index, txid[\s\S]*LIMIT \$5/u,
  );
  const source = topLevelFunctionSource(
    BACKFILL_PATH,
    "hydrateHistoricalCanonicalTransactionDetails",
  );
  assert.doesNotMatch(
    source,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+proof_indexer\.(?:meta|events|credit_|id_records|ledger_snapshots|blocks)\b/iu,
  );
});

check("historical detail hydration fails closed on detached block membership", async () => {
  const txid = "3".repeat(64);
  let persisted = false;
  const hydrateHistoricalCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "hydrateHistoricalCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX: -1,
      TX_DETAIL_HYDRATION_AFTER_HEIGHT: -1,
      TX_DETAIL_HYDRATION_AFTER_TXID: "",
      TX_DETAIL_HYDRATION_BATCH_SIZE: 1,
      TX_DETAIL_HYDRATION_MAX_ROWS: 1,
      assertHydratedProtocolTransaction: () => {},
      canonicalTransactionDetailRows: () => ({
        inputs: [{ vin: 0 }],
        opReturns: [{ vout: 1 }],
        outputs: [{ vout: 0 }, { vout: 1 }],
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      itemTime: () => "2026-07-13T00:00:00.000Z",
      persistCanonicalTransactionDetails: async () => {
        persisted = true;
        return { inputs: 1, opReturns: 1, outputs: 2 };
      },
      protocolMessagesFromTx: () => [{ prefix: "pwm1:" }],
    },
  );
  const blockHash = "4".repeat(64);
  const client = {
    async query(sql) {
      if (String(sql).trim().startsWith("WITH candidates AS")) {
        return {
          rows: [
            {
              block_canonical: false,
              block_hash: blockHash,
              block_height: 200,
              block_index: 1,
              block_time: "2026-07-13T00:00:00.000Z",
              canonical_block_hash: blockHash,
              raw_tx: {
                _powBlockIndex: 1,
                canonicalBlockScan: {
                  blockHash,
                  height: 200,
                  network: "livenet",
                },
                txid,
              },
              txid,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    hydrateHistoricalCanonicalTransactionDetails(client),
    /Stored canonical transaction detail envelope is invalid/u,
  );
  assert.equal(persisted, false);
});

check("canonical block envelopes and protocol prevout values fail closed", () => {
  const hash = "d".repeat(64);
  const assertCanonicalBlockEnvelope = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalBlockEnvelope",
    { isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)) },
  );
  assert.doesNotThrow(() =>
    assertCanonicalBlockEnvelope(
      { hash, height: 101, nTx: 1, tx: [{ txid: "e".repeat(64) }] },
      101,
      hash,
    ),
  );
  assert.throws(
    () =>
      assertCanonicalBlockEnvelope(
        { hash, height: 101, nTx: 2, tx: [{ txid: "e".repeat(64) }] },
        101,
        hash,
      ),
    /invalid block envelope/u,
  );
  const assertHydratedProtocolTransaction = isolatedFunction(
    BACKFILL_PATH,
    "assertHydratedProtocolTransaction",
    { isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)) },
  );
  assert.doesNotThrow(() =>
    assertHydratedProtocolTransaction({
      txid: "f".repeat(64),
      vin: [
        {
          prevout: {
            scriptPubKey: { address: "sender", hex: "51" },
            valueSats: 1_000,
          },
          txid: "1".repeat(64),
          vout: 0,
        },
      ],
    }),
  );
  assert.throws(
    () =>
      assertHydratedProtocolTransaction({
        txid: "f".repeat(64),
        vin: [{ txid: "1".repeat(64), vout: 0 }],
      }),
    /no complete canonical prevout/u,
  );
  assert.doesNotThrow(() =>
    assertHydratedProtocolTransaction({
      txid: "f".repeat(64),
      vin: [
        {
          prevout: {
            scriptPubKey: { hex: "51", type: "multisig" },
            valueSats: 1_000,
          },
          txid: "1".repeat(64),
          vout: 0,
        },
      ],
    }),
  );
  assert.throws(
    () =>
      assertHydratedProtocolTransaction({
        txid: "f".repeat(64),
        vin: [
          {
            prevout: { scriptPubKey: {}, valueSats: 1_000 },
            txid: "1".repeat(64),
            vout: 0,
          },
        ],
      }),
    /no complete canonical prevout/u,
  );
});

check("Core prevout hydration is deduplicated and concurrency bounded", async () => {
  const boundedMapWithConcurrency = isolatedFunction(
    BACKFILL_PATH,
    "boundedMapWithConcurrency",
  );
  const prevoutFromOutput = isolatedFunction(
    BACKFILL_PATH,
    "prevoutFromOutput",
    {
      satsFromVoutValue: (value) =>
        BigInt(Math.round(Number(value) * 100_000_000)),
    },
  );
  let active = 0;
  let maxActive = 0;
  let reads = 0;
  const transactionWithInputPrevouts = isolatedFunction(
    BACKFILL_PATH,
    "transactionWithInputPrevouts",
    {
      PREVOUT_HYDRATION_CONCURRENCY: 3,
      boundedMapWithConcurrency,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      prevoutFromOutput,
      rawTransactionFromCore: async () => {
        active += 1;
        reads += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          vout: [{ scriptPubKey: { hex: "51", type: "pubkey" }, value: 0.00001 }],
        };
      },
    },
  );
  const repeatedTxid = "a".repeat(64);
  const uniqueTxids = Array.from({ length: 11 }, (_, index) =>
    index.toString(16).padStart(64, "0"),
  );
  const hydrated = await transactionWithInputPrevouts({
    txid: "b".repeat(64),
    vin: [repeatedTxid, repeatedTxid, ...uniqueTxids].map((txid) => ({
      txid,
      vout: 0,
    })),
  });
  assert.equal(reads, 12);
  assert.ok(maxActive <= 3, `observed ${maxActive} concurrent Core reads`);
  assert.ok(hydrated.vin.every((input) => input.prevout?.valueSats === 1_000));
});

check("canonical API hydration propagates Core uncertainty but accepts addressless scripts", async () => {
  const txid = "c".repeat(64);
  const previousTxid = "d".repeat(64);
  const blockHash = "e".repeat(64);
  let previousAvailable = false;
  const mapWithConcurrency = isolatedFunction(API_PATH, "mapWithConcurrency");
  const transactionInputsHavePrevouts = isolatedFunction(
    API_PATH,
    "transactionInputsHavePrevouts",
  );
  const transactionHasCompleteCanonicalPrevouts = isolatedFunction(
    API_PATH,
    "transactionHasCompleteCanonicalPrevouts",
  );
  const fetchTransactionFromBitcoinRpc = isolatedFunction(
    API_PATH,
    "fetchTransactionFromBitcoinRpc",
    {
      MAX_TRANSACTION_CACHE_SIZE: 100,
      TRANSACTION_CACHE: new Map(),
      TX_FETCH_CONCURRENCY: 4,
      bitcoinRpc: async (_method, [requestedTxid]) => {
        if (requestedTxid === previousTxid && !previousAvailable) {
          return { error: { code: -28 }, ok: false };
        }
        if (requestedTxid === previousTxid) {
          return {
            ok: true,
            result: {
              blockhash: "f".repeat(64),
              confirmations: 10,
              height: 90,
              txid: previousTxid,
              vin: [{ coinbase: "00", sequence: 0 }],
              vout: [
                {
                  scriptPubKey: { asm: "1", hex: "51", type: "pubkey" },
                  value: 0.00002,
                },
              ],
            },
          };
        }
        return {
          ok: true,
          result: {
            blockhash: blockHash,
            confirmations: 1,
            height: 101,
            txid,
            vin: [{ sequence: 1, txid: previousTxid, vout: 0 }],
            vout: [
              {
                scriptPubKey: { asm: "OP_RETURN", hex: "6a", type: "nulldata" },
                value: 0,
              },
            ],
          },
        };
      },
      coreVoutToMempoolVout: (output) => ({
        scriptpubkey: String(output?.scriptPubKey?.hex ?? ""),
        scriptpubkey_address: String(output?.scriptPubKey?.address ?? ""),
        scriptpubkey_asm: String(output?.scriptPubKey?.asm ?? ""),
        scriptpubkey_type: String(output?.scriptPubKey?.type ?? ""),
        value: Math.round(Number(output?.value ?? 0) * 100_000_000),
      }),
      errorSummary: (error) => String(error?.message ?? error?.code ?? error),
      mapWithConcurrency,
      transactionHasCompleteCanonicalPrevouts,
      transactionInputsHavePrevouts,
    },
  );
  await rejection(
    fetchTransactionFromBitcoinRpc(txid, "livenet", {
      requireCanonicalPrevouts: true,
    }),
    (error) => /could not resolve canonical transaction/u.test(error.message),
    "A transient prevout RPC failure must abort canonical verification",
  );
  previousAvailable = true;
  const hydrated = await fetchTransactionFromBitcoinRpc(txid, "livenet", {
    requireCanonicalPrevouts: true,
  });
  assert.equal(hydrated.vin[0].prevout.value, 2_000);
  assert.equal(hydrated.vin[0].prevout.scriptpubkey, "51");
  assert.equal(hydrated.vin[0].prevout.scriptpubkey_address, "");
});

check("unknown aggregated PWM emits one invalid audit event", () => {
  const invalidProtocolItem = isolatedFunction(
    BACKFILL_PATH,
    "invalidProtocolItem",
  );
  const rawProtocolItemsForTx = isolatedFunction(
    BACKFILL_PATH,
    "rawProtocolItemsForTx",
    {
      Buffer,
      aggregatePwmProtocolItem: () => null,
      baseProtocolItem: (_tx, _message, kind) => ({
        amountSats: "546",
        kind,
        protocol: "pwm1",
        txid: "1".repeat(64),
      }),
      canonicalBondMintItemsFromMailItem: () => [],
      invalidProtocolItem,
      protocolItemsFromTx: () => [],
    },
  );
  const items = rawProtocolItemsForTx({}, [
    { prefix: "pwm1:", text: "pwm1:unknown:data", voutIndex: 1 },
    { prefix: "pwm1:", text: "pwm1:also-unknown", voutIndex: 2 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].valid, false);
  assert.equal(items[0].kind, "mail-invalid");
  assert.match(items[0].reason, /Malformed or unknown aggregated PWM/u);
});

check("bond companions mint each family recipient without double-counting value", () => {
  const powbTokenId = "a".repeat(64);
  const incbTokenId = "b".repeat(64);
  const canonicalBondMintItemsFromMailItem = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintItemsFromMailItem",
    {
      bondTagForKind: (kind) =>
        kind === "infinity-bond"
          ? { ticker: "POWB", tokenId: powbTokenId }
          : kind === "inception-bond"
            ? { ticker: "INCB", tokenId: incbTokenId }
            : null,
    },
  );
  const disambiguateDuplicateProtocolItems = isolatedFunction(
    BACKFILL_PATH,
    "disambiguateDuplicateProtocolItems",
  );
  const mints = disambiguateDuplicateProtocolItems(
    canonicalBondMintItemsFromMailItem({
      amountSats: "1000",
      blockHeight: 101,
      blockIndex: 3,
      confirmed: true,
      kind: "infinity-bond",
      network: "livenet",
      recipients: [
        { address: "alice", amountSats: "600" },
        { address: "bob", amountSats: "400" },
      ],
      txid: "2".repeat(64),
    }),
  );
  assert.deepEqual(
    mints.map((mint) => [mint.minterAddress, mint.amount, mint.amountSats]),
    [
      ["alice", "600", 0],
      ["bob", "400", 0],
    ],
  );
  assert.equal(mints[0].eventKeyVout, undefined);
  assert.equal(mints[1].eventKeyVout, 1);
  assert.deepEqual(mints.map((mint) => mint._powEventIndex), [0, 1]);
  const tokenMintHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenMintHistoryItemKey",
    {
      numericValue: (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
      },
    },
  );
  const mergeTokenStateItemsByKey = isolatedFunction(
    API_PATH,
    "mergeTokenStateItemsByKey",
    { compareTokenHistoryPageItems: () => 0 },
  );
  assert.equal(
    mergeTokenStateItemsByKey([], mints, tokenMintHistoryItemKey).length,
    2,
    "multi-recipient bond mints must survive scoped/history merges",
  );
  const [incbMint] = canonicalBondMintItemsFromMailItem({
    confirmed: true,
    kind: "inception-bond",
    recipients: [{ address: "carol", amountSats: "250" }],
    txid: "3".repeat(64),
  });
  assert.equal(incbMint.ticker, "INCB");
  assert.equal(incbMint.tokenId, incbTokenId);
  assert.equal(incbMint.amountSats, 0);
});

check("bond definitions bind to their canonical ID receivers", async () => {
  let definition;
  const seedCanonicalBondDefinition = isolatedFunction(
    BACKFILL_PATH,
    "seedCanonicalBondDefinition",
    {
      NETWORK: "livenet",
      upsertCanonicalSyntheticCreditDefinition: async (_client, value) => {
        definition = value;
      },
    },
  );
  const infinityTag = {
    createdAt: "2026-06-23T00:00:00.000Z",
    registryId: "infinity",
    ticker: "POWB",
    tokenId: POWB_TOKEN_ID,
    tokenMaxSupplyStorage: "0",
  };
  await seedCanonicalBondDefinition(
    {
      async query() {
        return {
          rows: [{ owner_address: "owner", receive_address: "bond-receiver" }],
        };
      },
    },
    infinityTag,
    { required: true },
  );
  assert.equal(definition.registryAddress, "bond-receiver");
  assert.equal(definition.ticker, "POWB");
  assert.equal(definition.maxSupply, null);
  assert.equal(definition.maxSupplyModel, "uncapped");
  assert.equal(definition.maxSupplyStorage, "0");
  assert.equal(definition.uncapped, true);

  let definitionWrite;
  const upsertCanonicalSyntheticCreditDefinition = isolatedFunction(
    BACKFILL_PATH,
    "upsertCanonicalSyntheticCreditDefinition",
    {
      BOND_UNCAPPED_MAX_SUPPLY_STORAGE: "0",
      NETWORK: "livenet",
      isWorkTokenId: () => false,
    },
  );
  await upsertCanonicalSyntheticCreditDefinition(
    {
      async query(sql, params) {
        definitionWrite = { params, sql: String(sql) };
        return { rows: [] };
      },
    },
    definition,
  );
  assert.equal(definitionWrite.params[5], "0");
  const storedMetadata = JSON.parse(definitionWrite.params[8]);
  assert.equal(storedMetadata.maxSupply, null);
  assert.equal(storedMetadata.maxSupplyModel, "uncapped");
  assert.equal(storedMetadata.uncapped, true);
  assert.equal("maxSupplyStorage" in storedMetadata, false);

  await rejection(
    seedCanonicalBondDefinition(
      { async query() { return { rows: [] }; } },
      infinityTag,
      { required: true },
    ),
    (error) => /confirmed infinity ID receiver/u.test(error.message),
  );
});

check("POWB bond mints rebuild holder supply before dependent transfers", async () => {
  const tokenId = "a".repeat(64);
  const writes = [];
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { NETWORK: "livenet" },
  );
  const result = await rebuildConfirmedCreditBalancesFromCanonicalEvents({
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return {
          rows: [{
            confirmed: true,
            created_height: null,
            max_supply: String(Number.MAX_SAFE_INTEGER),
            metadata: { canonicalSynthetic: true, uncapped: true },
            ticker: "POWB",
            token_id: tokenId,
          }],
        };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          // Deliberately returned in insertion-hostile order; canonical block
          // and event positions must place both bond mints before the spend.
          rows: [
            {
              canonical_block_height: 102,
              event_key: "transfer",
              kind: "token-transfer",
              payload: {
                _powEventIndex: 0,
                amount: 100,
                blockIndex: 0,
                recipientAddress: "carol",
                senderAddress: "alice",
                tokenId,
              },
              txid: "3".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_key: "mint-bob",
              kind: "token-mint",
              payload: {
                _powEventIndex: 1,
                amount: 400,
                amountSats: 0,
                blockIndex: 0,
                confirmed: true,
                minterAddress: "bob",
                sourceBondTxid: "2".repeat(64),
                ticker: "POWB",
                tokenId,
                validationMode: "canonical-powb-bond-projection",
              },
              txid: "2".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_key: "mint-alice",
              kind: "token-mint",
              payload: {
                _powEventIndex: 0,
                amount: 600,
                amountSats: 0,
                blockIndex: 0,
                confirmed: true,
                minterAddress: "alice",
                sourceBondTxid: "2".repeat(64),
                ticker: "POWB",
                tokenId,
                validationMode: "canonical-powb-bond-projection",
              },
              txid: "2".repeat(64),
            },
          ],
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return { rows: [] };
      }
      writes.push({ params: Array.from(params), sql: text });
      return { rows: [] };
    },
  });
  assert.equal(result.tokens, 1);
  const balances = new Map(
    writes
      .filter((write) => write.sql.includes("INSERT INTO proof_indexer.credit_balances"))
      .map((write) => [write.params[2], write.params[3]]),
  );
  assert.deepEqual(Object.fromEntries(balances), {
    alice: "500",
    bob: "400",
    carol: "100",
  });
});

check("canonical verifier admits only chain-bound rejected INCB bond mints", () => {
  const incbTokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const inceptionBondKind = "inception-bond";
  const queryParts = isolatedFunction(
    READER_PATH,
    "canonicalVerifierIncbInvalidEventQueryParts",
    {
      INCB_TOKEN_ID: incbTokenId,
      INCEPTION_BOND_KIND: inceptionBondKind,
    },
  );
  const query = queryParts("livenet", 958_383, 958_429);
  assert.deepEqual(Array.from(query.params), [
    "livenet",
    incbTokenId,
    inceptionBondKind,
    958_383,
    958_429,
  ]);
  assert.match(query.fromSql, /e\.valid = false/u);
  assert.match(query.fromSql, /e\.block_height = t\.block_height/u);
  assert.match(
    query.fromSql,
    /JOIN proof_indexer\.blocks b[\s\S]*b\.canonical = true/u,
  );
  assert.match(
    query.fromSql,
    /payload->>'blockHash'[\s\S]*= lower\(t\.block_hash\)/u,
  );
  assert.match(query.fromSql, /payload->>'sourceKind'[\s\S]*= \$3/u);
  assert.match(
    query.fromSql,
    /payload->>'sourceBondTxid'[\s\S]*= lower\(e\.txid\)/u,
  );
  assert.match(
    query.fromSql,
    /NOT EXISTS[\s\S]*valid_mint\.valid = true[\s\S]*valid_mint\.payload->>'tokenId'[\s\S]*= \$2/u,
  );

  const dispositionFromRow = isolatedFunction(
    READER_PATH,
    "canonicalVerifierIncbInvalidDispositionFromRow",
    {
      INCB_TOKEN_ID: incbTokenId,
      INCEPTION_BOND_KIND: inceptionBondKind,
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : {},
      tokenInvalidEventFromRow: (row) => ({
        ...row.payload,
        confirmed: row.effective_status === "confirmed",
        txid: String(row.payload?.txid ?? row.txid).toLowerCase(),
        valid: false,
      }),
    },
  );
  const rejectedBonds = [
    {
      blockHash:
        "00000000000000000001db52a4485f7d1a1784b7ba6c5b93db1b20449ac2628b",
      blockHeight: 958_383,
      txid: "c9c9f4e382f598aa39b3be57adc8fe1defeb80e5216387d3af6b0948da232aff",
    },
    {
      blockHash:
        "000000000000000000022e062fe6236b71722b7ade5079d5c45e73a5561252e1",
      blockHeight: 958_429,
      txid: "45b226453dde5b4d61a6a036af299d11ebfdeb65054bf26438ebc6ebebbf00c3",
    },
    {
      blockHash:
        "000000000000000000022e062fe6236b71722b7ade5079d5c45e73a5561252e1",
      blockHeight: 958_429,
      txid: "e08080c1d86f0770dd6ebbabd98a9e066dc6043b548af7ecb7912fbbdfad4d50",
    },
  ];
  const rowForBond = ({ blockHash, blockHeight, txid }) => ({
    block_hash: blockHash,
    block_height: blockHeight,
    effective_status: "confirmed",
    kind: "token-event-invalid",
    payload: {
      attemptedKind: "token-mint",
      blockHash,
      blockHeight,
      kind: "token-event-invalid",
      sourceBondTxid: txid,
      sourceKind: inceptionBondKind,
      tokenId: incbTokenId,
      txid,
    },
    protocol: "pwt1",
    status: "confirmed",
    transaction_block_height: blockHeight,
    txid,
    valid: false,
  });
  const firstRow = rowForBond(rejectedBonds[0]);
  for (const bond of rejectedBonds) {
    const row = rowForBond(bond);
    const event = dispositionFromRow(
      row,
      new Map([[bond.blockHeight, bond.blockHash]]),
    );
    assert.equal(event?.txid, bond.txid);
    assert.equal(event?.sourceBondTxid, bond.txid);
  }

  const canonicalBlocks = new Map([
    [rejectedBonds[0].blockHeight, rejectedBonds[0].blockHash],
  ]);
  assert.equal(
    dispositionFromRow({ ...firstRow, valid: true }, canonicalBlocks),
    null,
  );
  assert.equal(
    dispositionFromRow(
      { ...firstRow, block_height: firstRow.block_height + 1 },
      canonicalBlocks,
    ),
    null,
  );
  assert.equal(
    dispositionFromRow(
      firstRow,
      new Map([[firstRow.block_height, "f".repeat(64)]]),
    ),
    null,
  );
  assert.equal(
    dispositionFromRow(
      {
        ...firstRow,
        payload: { ...firstRow.payload, sourceKind: "infinity-bond" },
      },
      canonicalBlocks,
    ),
    null,
  );
  assert.equal(
    dispositionFromRow(
      {
        ...firstRow,
        payload: { ...firstRow.payload, sourceBondTxid: "f".repeat(64) },
      },
      canonicalBlocks,
    ),
    null,
  );
  assert.equal(
    dispositionFromRow(
      { ...firstRow, valid_incb_mint_overlap: true },
      canonicalBlocks,
    ),
    null,
  );

  const canonicalPayloadSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexCanonicalTransactionsPayload",
  );
  assert.match(
    canonicalPayloadSource,
    /canonicalVerifierIncbInvalidEventQueryParts/u,
  );
  assert.doesNotMatch(
    canonicalPayloadSource,
    /const invalidEventQuery = tokenInvalidEventQueryParts/u,
  );
});

check("canonical Core raw transactions normalize dependent replay inputs", () => {
  const canonicalCoreScriptType = isolatedFunction(
    READER_PATH,
    "canonicalCoreScriptType",
  );
  const canonicalCoreValueSats = isolatedFunction(
    READER_PATH,
    "canonicalCoreValueSats",
  );
  const objectRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const canonicalCoreOutput = isolatedFunction(
    READER_PATH,
    "canonicalCoreOutput",
    { canonicalCoreScriptType, canonicalCoreValueSats, objectRecord },
  );
  const canonicalRawTransactionFromRow = isolatedFunction(
    READER_PATH,
    "canonicalRawTransactionFromRow",
    {
      canonicalCoreOutput,
      canonicalCoreValueSats,
      objectRecord,
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
    },
  );
  const blockHash = "3".repeat(64);
  const txid = "4".repeat(64);
  const normalized = canonicalRawTransactionFromRow(
    {
      block_hash: blockHash,
      block_height: 101,
      block_time: "2026-07-11T00:00:00.000Z",
      raw_tx: {
        _powBlockIndex: 2,
        canonicalBlockScan: { blockHash, height: 101, network: "livenet" },
        fee: 0.000001,
        locktime: 0,
        txid,
        version: 2,
        vin: [
          {
            prevout: {
              scriptPubKey: {
                address: "sender",
                asm: "1",
                hex: "51",
                type: "witness_v1_taproot",
              },
              value: 0.00002,
            },
            sequence: 1,
            txid: "5".repeat(64),
            vout: 0,
          },
        ],
        vout: [
          {
            scriptPubKey: { asm: "OP_RETURN", hex: "6a", type: "nulldata" },
            value: 0.00001,
          },
        ],
        weight: 400,
      },
      txid,
    },
    "livenet",
  );
  assert.equal(normalized._powBlockIndex, 2);
  assert.equal(normalized.vin[0].prevout.value, 2_000);
  assert.equal(normalized.vin[0].prevout.scriptpubkey_address, "sender");
  assert.equal(normalized.vin[0].prevout.scriptpubkey_type, "v1_p2tr");
  assert.equal(normalized.vout[0].value, 1_000);
  assert.equal(normalized.vout[0].scriptpubkey_type, "op_return");
  assert.equal(normalized.fee, 100);
  assert.equal(normalized.status.block_height, 101);
});

check("confirmed token scope distinguishes resolved invalid and ambiguous evidence", async () => {
  const listingId = "a".repeat(64);
  const tokenId = "b".repeat(64);
  const buyTxid = "c".repeat(64);
  const delistTxid = "d".repeat(64);
  const unresolvedTxid = "e".repeat(64);
  const malformedTxid = "1".repeat(64);
  const mixedTxid = "2".repeat(64);
  const ambiguousListingId = "3".repeat(64);
  const ambiguousTxid = "4".repeat(64);
  const otherTokenId = "5".repeat(64);
  const blockHash = "6".repeat(64);
  const confirmedTokenVerifierScopeFromContext = isolatedFunction(
    API_PATH,
    "confirmedTokenVerifierScopeFromContext",
    {
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      canonicalTokenListingScopeEvidenceFromCore: async () => ({
        reason: "referenced-listing-does-not-exist",
        status: "deterministically-invalid",
      }),
      decodedProtocolMessages: (vout) => vout.map((output) => output.message),
      parseTokenPayload: (message) => message,
      transactionBlockHash: (tx) => tx.status?.block_hash ?? "",
      transactionBlockHeight: (tx) => tx.status?.block_height,
      transactionTxid: (tx) => tx.txid,
    },
  );
  const currentBlock = (tx) => ({
    ...tx,
    status: { block_hash: blockHash, block_height: 101, confirmed: true },
  });
  const context = {
    blockHash,
    coverageHeight: 101,
    transactions: [
      {
        txid: listingId,
        vout: [
          {
            message: {
              kind: "list",
              saleAuthorization: {
                registryAddress: "bc1registry",
                tokenId,
              },
            },
          },
        ],
      },
      currentBlock({
        txid: buyTxid,
        vout: [{ message: { kind: "buy", listingId } }],
      }),
      currentBlock({
        txid: delistTxid,
        vout: [{ message: { kind: "delist", listingId } }],
      }),
      currentBlock({
        txid: unresolvedTxid,
        vout: [
          {
            message: {
              kind: "buy",
              listingId: "f".repeat(64),
            },
          },
        ],
      }),
      currentBlock({
        txid: malformedTxid,
        vout: [{ message: null }],
      }),
      currentBlock({
        txid: mixedTxid,
        vout: [
          { message: null },
          { message: { kind: "send", tokenId } },
        ],
      }),
      {
        txid: ambiguousListingId,
        vout: [
          {
            message: {
              kind: "list",
              saleAuthorization: { tokenId },
            },
          },
          {
            message: {
              kind: "list",
              saleAuthorization: { tokenId: otherTokenId },
            },
          },
        ],
      },
      currentBlock({
        txid: ambiguousTxid,
        vout: [{ message: { kind: "buy", listingId: ambiguousListingId } }],
      }),
    ],
  };
  const buy = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    buyTxid,
  );
  assert.equal(buy.scope, tokenId);
  assert.equal(buy.status, "resolved");
  const delist = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    delistTxid,
  );
  assert.equal(delist.scope, tokenId);
  assert.equal(delist.status, "resolved");
  const invalid = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    unresolvedTxid,
  );
  assert.equal(invalid.reason, "referenced-listing-is-not-canonical");
  assert.equal(invalid.status, "deterministically-invalid");
  const malformed = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    malformedTxid,
  );
  assert.equal(malformed.status, "deterministically-invalid");
  const mixed = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    mixedTxid,
  );
  assert.equal(mixed.scope, tokenId);
  assert.equal(mixed.status, "resolved");
  const ambiguous = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    ambiguousTxid,
  );
  assert.equal(ambiguous.reason, "ambiguous-token-scope");
  assert.equal(ambiguous.status, "unresolved");
});

check("a canonical listing missing from DB context is unavailable, not invalid", async () => {
  const listingId = "7".repeat(64);
  const tokenId = "8".repeat(64);
  const listingBlockHash = "9".repeat(64);
  let mode = "canonical";
  const canonicalTokenListingScopeEvidenceFromCore = isolatedFunction(
    API_PATH,
    "canonicalTokenListingScopeEvidenceFromCore",
    {
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction") {
          return mode === "missing"
            ? { error: { code: -5 }, ok: false }
            : {
                ok: true,
                result: {
                  blockhash: listingBlockHash,
                  confirmations: 2,
                  vout: [{ message: { kind: "list", saleAuthorization: { tokenId } } }],
                },
              };
        }
        if (method === "getblockheader") {
          return { ok: true, result: { height: 100 } };
        }
        if (method === "getblockhash") {
          return { ok: true, result: listingBlockHash };
        }
        throw new Error(`unexpected method ${method}`);
      },
      coreVoutToMempoolVout: (output) => output,
      decodedProtocolMessages: (vout) => vout.map((output) => output.message),
      parseTokenPayload: (message) => message,
    },
  );
  const unresolved = await canonicalTokenListingScopeEvidenceFromCore(
    { coverageHeight: 101 },
    "livenet",
    listingId,
  );
  assert.equal(unresolved.status, "unresolved");
  assert.equal(
    unresolved.reason,
    "canonical-listing-is-missing-from-index-context",
  );

  mode = "missing";
  const invalid = await canonicalTokenListingScopeEvidenceFromCore(
    { coverageHeight: 101 },
    "livenet",
    listingId,
  );
  assert.equal(invalid.status, "deterministically-invalid");
  assert.equal(invalid.reason, "referenced-listing-does-not-exist");
});

check("same-height verifier contexts are cached by exact block identity", async () => {
  const previousBlockHash = "a".repeat(64);
  const firstBlockHash = "b".repeat(64);
  const replacementBlockHash = "c".repeat(64);
  const keys = [];
  const loads = [];
  const canonicalVerifierContextFromCheckpoint = isolatedFunction(
    API_PATH,
    "canonicalVerifierContextFromCheckpoint",
    {
      cachedInternalVerifierState: async (key, loader) => {
        keys.push(key);
        return loader();
      },
      loadCanonicalVerifierContextFromCheckpoint: async (...args) => {
        loads.push(args);
        return { blockHash: args[2], coverageHeight: args[1] };
      },
      pruneInternalVerifierStateCache: () => {},
    },
  );
  await canonicalVerifierContextFromCheckpoint(
    "livenet",
    101,
    firstBlockHash,
    previousBlockHash,
  );
  await canonicalVerifierContextFromCheckpoint(
    "livenet",
    101,
    replacementBlockHash,
    previousBlockHash,
  );
  assert.equal(loads.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys[0].includes(firstBlockHash));
  assert.ok(keys[1].includes(replacementBlockHash));
});

check("canonical verifier rejects a replaced block before state hydration", async () => {
  const expectedBlockHash = "d".repeat(64);
  const replacementBlockHash = "e".repeat(64);
  let calls = 0;
  const canonicalVerifierCurrentBlock = isolatedFunction(
    API_PATH,
    "canonicalVerifierCurrentBlock",
    {
      bitcoinRpc: async (method) => {
        calls += 1;
        assert.equal(method, "getblockhash");
        return { ok: true, result: replacementBlockHash };
      },
    },
  );
  await rejection(
    canonicalVerifierCurrentBlock(
      "livenet",
      101,
      "f".repeat(64),
      expectedBlockHash,
    ),
    (error) => /does not match the requested canonical hash/u.test(error.message),
    "A same-height replacement must not reuse or hydrate the old block",
  );
  assert.equal(calls, 1);
});

check("confirmed unscoped token verifier caches by target txid", async () => {
  const firstTxid = "1".repeat(64);
  const secondTxid = "2".repeat(64);
  const tokenId = "3".repeat(64);
  const blockHash = "4".repeat(64);
  const previousBlockHash = "5".repeat(64);
  const cacheKeys = [];
  const confirmedLoads = [];
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      WORK_TOKEN_ID: "work",
      cachedInternalVerifierState: async (key, loader) => {
        cacheKeys.push(key);
        return loader();
      },
      completeTokenVerifierState: async (...args) => {
        confirmedLoads.push(args);
        return {
          blockHash,
          canonicalCoverage: true,
          coverageHeight: 101,
          indexedThroughBlock: 101,
          previousBlockHash,
        };
      },
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pendingCoreWorkMarketplaceVerifierContext: async () => null,
      pendingWorkMintSupplyCapVerifierPayload: async () => null,
      pruneInternalVerifierStateCache: () => {},
      tokenPayload: async () => ({
        indexedThroughBlock: 100,
        pendingFixture: true,
      }),
      tokenVerifierDeterministicInvalidReason: async () => "",
      tokenVerifierItemsFromState: (state, txid) => [
        {
          blockHeight: 101,
          confirmed: !state.pendingFixture,
          kind: state.pendingFixture ? "token-event-invalid" : "token-sale",
          tokenId,
          txid,
          valid: !state.pendingFixture,
        },
      ],
      verifierBalanceSnapshot: () => null,
      workTokenPayload: async () => ({}),
    },
  );
  for (const txid of [firstTxid, secondTxid]) {
    await tokenVerifierPayload("livenet", "all", txid, {
      blockHash,
      blockHeight: 101,
      previousBlockHash,
      requireConfirmed: true,
    });
  }
  await tokenVerifierPayload("livenet", "all", firstTxid);

  assert.deepEqual(
    confirmedLoads.map((args) => args[3]),
    [firstTxid, secondTxid],
  );
  assert.ok(
    cacheKeys.includes(
      `token-complete:livenet:tx:${firstTxid}:h101:${previousBlockHash}:${blockHash}`,
    ),
  );
  assert.ok(
    cacheKeys.includes(
      `token-complete:livenet:tx:${secondTxid}:h101:${previousBlockHash}:${blockHash}`,
    ),
  );
  assert.ok(cacheKeys.includes("token:livenet:all"));
});

check("pending Core WORK marketplace context resolves confirmed listing parents", async () => {
  const workTokenId = "d".repeat(64);
  const targetTxid = "a".repeat(64);
  const listingId = "b".repeat(64);
  const target = {
    _powCanonicalRpcHydration: true,
    complete: true,
    confirmed: false,
    txid: targetTxid,
    vout: [{ message: `delist:${listingId}` }],
  };
  const listing = {
    _powCanonicalRpcHydration: true,
    complete: true,
    confirmed: true,
    txid: listingId,
    vout: [{ message: "list-work" }],
  };
  const cached = [];
  let mempoolReads = 0;
  const pendingCoreWorkMarketplaceVerifierContext = isolatedFunction(
    API_PATH,
    "pendingCoreWorkMarketplaceVerifierContext",
    {
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      WORK_TOKEN_ID: workTokenId,
      bitcoinRpc: async (method, params) => {
        assert.equal(method, "getmempoolentry");
        assert.equal(params[0], targetTxid);
        mempoolReads += 1;
        return { ok: true, result: { time: 1_700_000_000 } };
      },
      cachePendingTokenTransaction: (...args) => {
        cached.push(args);
        return true;
      },
      coreMempoolEntryPresent: (response) =>
        response?.ok === true && Boolean(response.result),
      decodedProtocolMessages: (vout) =>
        vout.map((output) => output.message),
      dedupeTransactions: (transactions) => transactions,
      fetchTransactionFromBitcoinRpc: async (txid, _network, options) => {
        assert.equal(options.requireCanonicalPrevouts, true);
        return txid === targetTxid ? target : txid === listingId ? listing : null;
      },
      parseTokenPayload: (message) => {
        if (message === `delist:${listingId}`) {
          return { kind: "delist", listingId };
        }
        if (message === "list-work") {
          return {
            kind: "list",
            saleAuthorization: { tokenId: workTokenId },
          };
        }
        return null;
      },
      transactionConfirmed: (tx) => tx?.confirmed === true,
      transactionHasCompleteCanonicalPrevouts: (tx) => tx?.complete === true,
      transactionTxid: (tx) => String(tx?.txid ?? "").toLowerCase(),
    },
  );

  const context = await pendingCoreWorkMarketplaceVerifierContext(
    "livenet",
    targetTxid,
  );
  assert.equal(context.scope, workTokenId);
  assert.equal(context.targetTransaction.txid, targetTxid);
  assert.deepEqual(
    Array.from(context.supportingTransactions, (tx) => tx.txid),
    [listingId],
  );
  assert.equal(mempoolReads, 2);
  assert.equal(cached.length, 1);
  assert.equal(cached[0][0].txid, targetTxid);
  assert.equal(cached[0][2], "core-pending-token-verifier");
});

check("pending Core WORK marketplace context fails closed on a liveness race", async () => {
  const workTokenId = "d".repeat(64);
  const targetTxid = "a".repeat(64);
  const target = {
    _powCanonicalRpcHydration: true,
    complete: true,
    confirmed: false,
    txid: targetTxid,
    vout: [{ message: "list-work" }],
  };
  let mempoolReads = 0;
  let cached = false;
  const pendingCoreWorkMarketplaceVerifierContext = isolatedFunction(
    API_PATH,
    "pendingCoreWorkMarketplaceVerifierContext",
    {
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      WORK_TOKEN_ID: workTokenId,
      bitcoinRpc: async () => {
        mempoolReads += 1;
        return mempoolReads === 1
          ? { ok: true, result: { time: 1_700_000_000 } }
          : { ok: false, error: { code: -5 } };
      },
      cachePendingTokenTransaction: () => {
        cached = true;
      },
      coreMempoolEntryPresent: (response) =>
        response?.ok === true && Boolean(response.result),
      decodedProtocolMessages: (vout) =>
        vout.map((output) => output.message),
      dedupeTransactions: (transactions) => transactions,
      fetchTransactionFromBitcoinRpc: async () => target,
      parseTokenPayload: () => ({
        kind: "list",
        saleAuthorization: { tokenId: workTokenId },
      }),
      transactionConfirmed: (tx) => tx?.confirmed === true,
      transactionHasCompleteCanonicalPrevouts: (tx) => tx?.complete === true,
      transactionTxid: (tx) => String(tx?.txid ?? "").toLowerCase(),
    },
  );

  assert.equal(
    await pendingCoreWorkMarketplaceVerifierContext("livenet", targetTxid),
    null,
  );
  assert.equal(mempoolReads, 2);
  assert.equal(cached, false);
});

check("pending unscoped WORK marketplace verification uses a per-tx Core replay", async () => {
  const txid = "a".repeat(64);
  const tokenId = "d".repeat(64);
  const cacheKeys = [];
  let broadLoads = 0;
  let indexedBaseLoads = 0;
  const targetTransaction = { confirmed: false, txid };
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      WORK_TOKEN_ID: tokenId,
      cachedInternalVerifierState: async (key, loader) => {
        cacheKeys.push(key);
        return loader();
      },
      currentProofIndexTokenPayloadForRead: async (
        network,
        scope,
        label,
        timeoutMs,
      ) => {
        assert.equal(network, "livenet");
        assert.equal(scope, tokenId);
        assert.equal(label, "pending-core-work-marketplace-verifier");
        assert.equal(timeoutMs, 10_000);
        indexedBaseLoads += 1;
        return { source: "exact-indexed-work-base" };
      },
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pendingCoreWorkMarketplaceVerifierContext: async () => ({
        scope: tokenId,
        supportingTransactions: [{ confirmed: true, txid: "b".repeat(64) }],
        targetTransaction,
      }),
      pendingWorkMintSupplyCapVerifierPayload: async () => null,
      tokenPayload: async () => {
        broadLoads += 1;
        return {};
      },
      tokenVerifierDeterministicInvalidReason: async () => "",
      tokenVerifierItemsFromState: (state) =>
        state.replayed
          ? [{
              confirmed: false,
              kind: "token-listing-closed",
              tokenId,
              txid,
              valid: true,
            }]
          : [],
      verifierBalanceSnapshot: () => null,
      workTokenPayload: async () => {
        throw new Error("The Core marketplace replay must use indexed state.");
      },
      workTokenStateWithDeltaTransactions: (state, transactions) => ({
        ...state,
        replayed: transactions.at(-1) === targetTransaction,
      }),
    },
  );

  const payload = await tokenVerifierPayload("livenet", "all", txid);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].confirmed, false);
  assert.equal(payload.items[0].kind, "token-listing-closed");
  assert.equal(broadLoads, 0);
  assert.equal(indexedBaseLoads, 1);
  assert.ok(cacheKeys.includes(`token-indexed-current:livenet:${tokenId}`));
  assert.ok(
    cacheKeys.includes(`token-pending-core:livenet:${tokenId}:${txid}`),
  );
});

check("a pending marketplace mutation against a confirmed close is invalid", async () => {
  const txid = "a".repeat(64);
  const listingId = "b".repeat(64);
  const registryAddress = "work-registry";
  const transaction = { confirmed: false, txid, vout: [{}] };
  const tokenVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "tokenVerifierDeterministicInvalidReason",
    {
      TOKEN_CREATION_PRICE_SATS: 546,
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      decodedProtocolMessages: () => [`pwt1:seal5:${listingId}:fixture`],
      numericValue: (value) => Number(value) || 0,
      parseTokenPayload: () => ({ kind: "seal", listingId }),
      tokenIndexAddressForNetwork: () => "token-index",
      tokenPaymentAmountBeforeProtocol: () => 546,
      transactionBlockHeight: () => 0,
      transactionConfirmed: (tx) => tx?.confirmed === true,
      transactionTxid: (tx) => String(tx?.txid ?? "").toLowerCase(),
    },
  );
  assert.equal(
    await tokenVerifierDeterministicInvalidReason(
      "livenet",
      {
        closedListings: [{
          closedConfirmed: true,
          listingId,
          registryAddress,
        }],
        listings: [],
      },
      txid,
      false,
      { transaction },
    ),
    "Referenced ProofOfWork credit listing is already closed.",
  );
});

check("bond verifier snapshots preserve unsafe exact balances", () => {
  const tokenId = "d".repeat(64);
  const address = "bc1bondholder";
  const unsafeBalance = "9007199254740993";
  const verifierBalanceSnapshot = isolatedFunction(
    API_PATH,
    "verifierBalanceSnapshot",
    {
      bondUnitsBigInt: (value, { allowZero = false } = {}) => {
        const text = String(value ?? "");
        if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) return null;
        const integer = BigInt(text);
        return !allowZero && integer === 0n ? null : integer;
      },
      isBondTokenId: (candidate) => candidate === tokenId,
      isValidBitcoinAddress: () => true,
      isWorkTokenId: () => false,
      tokenLedgerBalanceFields: (_candidate, balance) => ({
        balance: balance.toString(),
      }),
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(verifierBalanceSnapshot(
      {
        holders: [
          { address, balance: unsafeBalance },
          { address: "bc1zero", balance: "0" },
          { address: "bc1malformed", balance: "9007199254740993.1" },
        ],
        indexedThroughBlock: 958_665,
      },
      tokenId,
    ))),
    {
      holders: [{ address, balance: unsafeBalance }],
      indexedThroughBlock: 958_665,
      tokenId,
    },
  );
});

check("pending bond listings compare unsafe balances exactly", async () => {
  const txid = "a".repeat(64);
  const tokenId = "d".repeat(64);
  const sellerAddress = "bc1bondseller";
  const registryAddress = "bond-registry";
  const unsafeAmount = "9007199254740993";
  const transaction = {
    confirmed: false,
    txid,
    vin: [{ address: sellerAddress }],
    vout: [{}],
  };
  const tokenVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "tokenVerifierDeterministicInvalidReason",
    {
      TOKEN_CREATION_PRICE_SATS: 546,
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      decodedProtocolMessages: () => ["pwt1:list5:fixture"],
      inputAddresses: (vin) => vin.map((input) => input.address),
      insufficientTokenBalanceInvalidEvent: ({
        amount,
        confirmedBalance,
        reservedBalance,
      }) => ({
        reason:
          `${(confirmedBalance - reservedBalance).toString()} available; ` +
          `${amount.toString()} attempted.`,
      }),
      isBondTokenId: (candidate) => candidate === tokenId,
      isWorkTokenId: () => false,
      numericValue: (value) => Number(value) || 0,
      parseTokenPayload: () => ({
        kind: "list",
        saleAuthorization: {
          amount: unsafeAmount,
          registryAddress,
          sellerAddress,
          ticker: "INCB",
          tokenId,
        },
      }),
      tokenIndexAddressForNetwork: () => "token-index",
      tokenLedgerAmountFromRecord: (_candidate, record) =>
        BigInt(record.amount),
      tokenLedgerZero: () => 0n,
      tokenListingIsExpired: () => false,
      tokenPaymentAmountBeforeProtocol: () => 546,
      tokenSaleAuthorizationLedgerAmount: (authorization) =>
        BigInt(authorization.amount),
      transactionBlockHeight: () => 0,
      transactionConfirmed: (tx) => tx?.confirmed === true,
      transactionTxid: (tx) => String(tx?.txid ?? "").toLowerCase(),
      bondUnitsBigInt: (value) => BigInt(value),
    },
  );
  const state = {
    holders: [{ address: sellerAddress, balance: unsafeAmount, tokenId }],
    listings: [{
      amount: "1",
      sellerAddress,
      tokenId,
    }],
    tokens: [{ ticker: "INCB", tokenId }],
  };
  assert.equal(
    await tokenVerifierDeterministicInvalidReason(
      "livenet",
      state,
      txid,
      false,
      { exactPendingCoreState: true, transaction },
    ),
    "9007199254740992 available; 9007199254740993 attempted.",
  );
});

check("a pending WORK listing above exact spendable balance is invalid", async () => {
  const txid = "a".repeat(64);
  const tokenId = "d".repeat(64);
  const sellerAddress = "bc1seller";
  const registryAddress = "work-registry";
  const transaction = {
    confirmed: false,
    txid,
    vin: [{ address: sellerAddress }],
    vout: [{}],
  };
  const tokenVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "tokenVerifierDeterministicInvalidReason",
    {
      TOKEN_CREATION_PRICE_SATS: 546,
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      decodedProtocolMessages: () => ["pwt1:list5:fixture"],
      inputAddresses: (vin) => vin.map((input) => input.address),
      insufficientTokenBalanceInvalidEvent: ({
        amount,
        confirmedBalance,
        reservedBalance,
        ticker,
      }) => {
        const spendableBalance = confirmedBalance - reservedBalance;
        return {
          reason:
            `Insufficient spendable ${ticker} balance: ` +
            `${spendableBalance.toLocaleString("en-US")} available; ` +
            `${amount.toLocaleString("en-US")} attempted.`,
        };
      },
      numericValue: (value) => Number(value) || 0,
      parseTokenPayload: () => ({
        kind: "list",
        saleAuthorization: {
          amount: 5_000,
          registryAddress,
          sellerAddress,
          ticker: "WORK",
          tokenId,
        },
      }),
      tokenIndexAddressForNetwork: () => "token-index",
      tokenListingIsExpired: () => false,
      tokenPaymentAmountBeforeProtocol: () => 546,
      transactionBlockHeight: () => 0,
      transactionConfirmed: (tx) => tx?.confirmed === true,
      transactionTxid: (tx) => String(tx?.txid ?? "").toLowerCase(),
    },
  );
  const state = {
    holders: [{ address: sellerAddress, balance: 3_000, tokenId }],
    listings: [],
    tokens: [{ ticker: "WORK", tokenId }],
  };
  assert.equal(
    await tokenVerifierDeterministicInvalidReason(
      "livenet",
      state,
      txid,
      false,
      { transaction },
    ),
    "",
    "A non-exact pending balance must remain unresolved.",
  );
  assert.equal(
    await tokenVerifierDeterministicInvalidReason(
      "livenet",
      state,
      txid,
      false,
      { exactPendingCoreState: true, transaction },
    ),
    "Insufficient spendable WORK balance: 3,000 available; 5,000 attempted.",
  );
});

check("WORK pending cap follows canonical txid order instead of mempool time", () => {
  const sortWorkMintsForPendingCap = isolatedFunction(
    API_PATH,
    "sortWorkMintsForPendingCap",
  );
  const workMintRowsWithinPendingCap = isolatedFunction(
    API_PATH,
    "workMintRowsWithinPendingCap",
    {
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      sortWorkMintsForPendingCap,
    },
  );
  const earlierTxid = "1".repeat(64);
  const laterTxid = "2".repeat(64);
  const pending = [
    {
      amount: 1_000,
      confirmed: false,
      createdAt: "2026-07-15T01:00:00.000Z",
      txid: laterTxid,
    },
    {
      amount: 1_000,
      confirmed: false,
      createdAt: "2026-07-15T02:00:00.000Z",
      txid: earlierTxid,
    },
  ];
  assert.deepEqual(
    Array.from(sortWorkMintsForPendingCap(pending), (mint) => mint.txid),
    [earlierTxid, laterTxid],
  );
  const capped = workMintRowsWithinPendingCap([
    {
      amount: 20_999_000,
      confirmed: true,
      createdAt: "2026-07-14T00:00:00.000Z",
      txid: "0".repeat(64),
    },
    ...pending,
  ]);
  assert.deepEqual(
    Array.from(
      capped.filter((mint) => !mint.confirmed),
      (mint) => mint.txid,
    ),
    [earlierTxid],
  );
});

check("pending WORK supply-cap fast path is exact and bypasses broad replay", async () => {
  const txid = "6".repeat(64);
  const earlierWitnessTxid = "5".repeat(64);
  const laterWitnessTxid = "7".repeat(64);
  const workTokenId =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const registryAddress = "work-registry";
  const blockHash = "a".repeat(64);
  const tipHeight = 958_079;
  const mintMessage = `pwt1:mint:${workTokenId}:1000`;
  const actorAddress = "actor-address";
  const pendingWorkMintFromHydratedTransaction = isolatedFunction(
    API_PATH,
    "pendingWorkMintFromHydratedTransaction",
    {
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: registryAddress,
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_MINT_AMOUNT: 1_000,
      WORK_TOKEN_MINT_PRICE_SATS: 1_000,
      decodedProtocolMessages: (vout) =>
        vout.flatMap((output) => output.message ? [output.message] : []),
      inputAddresses: (vin) =>
        vin.flatMap((input) => input?.prevout?.scriptpubkey_address
          ? [input.prevout.scriptpubkey_address]
          : []),
      isValidBitcoinAddress: (address, network) =>
        network === "livenet" && address === actorAddress,
      parseTokenPayload: (message) => {
        const [prefix, kind, tokenId, amount] = String(message).split(":");
        const parsedAmount = Number(amount);
        return prefix === "pwt1" &&
            ["mint", "send"].includes(kind) &&
            /^[0-9a-f]{64}$/u.test(tokenId) &&
            Number.isSafeInteger(parsedAmount)
          ? { amount: parsedAmount, kind, tokenId }
          : null;
      },
      tokenPaymentAmountBeforeProtocol: (vout, address) =>
        vout.reduce(
          (total, output) =>
            output.address === address
              ? total + Number(output.valueSats ?? 0)
              : total,
          0,
        ),
      transactionConfirmed: (transaction) =>
        transaction?.status?.confirmed === true,
      transactionHasCompleteCanonicalPrevouts: (transaction) =>
        (Array.isArray(transaction?.vin) ? transaction.vin : []).every(
          (input) =>
            input?.prevout &&
            Number.isSafeInteger(Number(input.prevout.value)) &&
            typeof input.prevout.scriptpubkey === "string",
        ),
      transactionTxid: (transaction) =>
        String(transaction?.txid ?? "").toLowerCase(),
    },
  );
  const exactCoreTipFromBlockchainInfo = isolatedFunction(
    API_PATH,
    "exactCoreTipFromBlockchainInfo",
  );
  const proofIndexExactlyCoversCoreTip = isolatedFunction(
    API_PATH,
    "proofIndexExactlyCoversCoreTip",
  );
  const coreMempoolEntryPresent = isolatedFunction(
    API_PATH,
    "coreMempoolEntryPresent",
  );
  const exactPendingWorkMintStats = isolatedFunction(
    API_PATH,
    "exactPendingWorkMintStats",
    {
      PENDING_WORK_MINT_WITNESS_LIMIT: 32,
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_TOKEN_MINT_AMOUNT: 1_000,
    },
  );
  const pendingWorkMintWitnessProof = isolatedFunction(
    API_PATH,
    "pendingWorkMintWitnessProof",
    {
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_TOKEN_MINT_AMOUNT: 1_000,
    },
  );
  const hydratedTransaction = (
    message = mintMessage,
    paidSats = 1_000,
    responseTxid = txid,
    inputAddress = actorAddress,
  ) => ({
    _powCanonicalRpcHydration: true,
    status: { confirmed: false },
    txid: responseTxid,
    vin: [{
      prevout: {
        scriptpubkey: "0014",
        scriptpubkey_address: inputAddress,
        value: 2_000,
      },
    }],
    vout: [
      { address: registryAddress, valueSats: paidSats },
      { message },
    ],
  });
  assert.equal(
    pendingWorkMintFromHydratedTransaction(
      hydratedTransaction(`pwt1:send:${workTokenId}:1000`),
      "livenet",
      txid,
    ),
    null,
  );
  assert.equal(
    pendingWorkMintFromHydratedTransaction(
      hydratedTransaction(mintMessage, 1_001),
      "livenet",
      txid,
    ),
    null,
  );
  assert.equal(
    pendingWorkMintFromHydratedTransaction(
      { ...hydratedTransaction(), vin: [] },
      "livenet",
      txid,
    ),
    null,
  );
  assert.equal(
    pendingWorkMintFromHydratedTransaction(
      hydratedTransaction(mintMessage, 1_000, txid, "not-an-address"),
      "livenet",
      txid,
    ),
    null,
  );

  const canonical = {
    fault: null,
    rebuild: { active: false, status: "complete" },
  };
  const status = (height = tipHeight) => ({
    indexedAt: "2026-07-15T01:30:00.000Z",
    indexedThroughBlock: height,
    network: "livenet",
    scan: {
      blockHash,
      complete: true,
      tipHeight: height,
    },
    source: "proof-indexer-block-scan",
  });
  const baseMintStats = () => ({
    confirmedMints: 20_999,
    confirmedSupply: 20_999_000,
    indexedAt: "2026-07-15T01:30:00.000Z",
    network: "livenet",
    pendingCandidateCount: 1,
    pendingCandidates: [{ amount: 1_000, txid: earlierWitnessTxid }],
    pendingCandidatesComplete: true,
    pendingCandidateSupply: 1_000,
    pendingMints: 1,
    pendingSupply: 1_000,
    pendingWitnessLimit: 32,
    source: "proof-indexer-token-mint-events",
    targetMintStats: {
      confirmedMints: 0,
      pendingMints: 0,
      totalMints: 0,
      txid,
    },
    tokenId: workTokenId,
    totalMints: 21_000,
  });

  let protocolMessage = mintMessage;
  let statusHeight = tipHeight;
  let statsMode = "stable";
  let mintStatsReads = 0;
  let candidateTxid = earlierWitnessTxid;
  let staleWitness = false;
  let witnessDropsOnFinalCheck = false;
  let canonicalHydrationRequests = 0;
  const mempoolReads = new Map();
  const fetchTransactionFromBitcoinRpc = async (
    requestedTxid,
    network,
    options,
  ) => {
    assert.equal(network, "livenet");
    assert.equal(options?.requireCanonicalPrevouts, true);
    canonicalHydrationRequests += 1;
    const normalizedRequestedTxid = String(requestedTxid ?? "").toLowerCase();
    if (normalizedRequestedTxid === candidateTxid && staleWitness) {
      return null;
    }
    return hydratedTransaction(
      normalizedRequestedTxid === txid ? protocolMessage : mintMessage,
      1_000,
      normalizedRequestedTxid,
    );
  };
  const bitcoinRpc = async (method, params) => {
    const requestedTxid = String(params?.[0] ?? "").toLowerCase();
    if (method === "getmempoolentry") {
      const reads = Number(mempoolReads.get(requestedTxid) ?? 0) + 1;
      mempoolReads.set(requestedTxid, reads);
      if (
        (requestedTxid === candidateTxid && staleWitness) ||
        (requestedTxid === candidateTxid &&
          witnessDropsOnFinalCheck &&
          reads >= 2)
      ) {
        return { error: { code: -5 }, ok: false };
      }
      return { ok: true, result: { time: 1_720_999_000 } };
    }
    if (method === "getblockchaininfo") {
      return {
        ok: true,
        result: {
          bestblockhash: blockHash,
          blocks: tipHeight,
          headers: tipHeight,
        },
      };
    }
    return null;
  };
  const proofIndexTokenMintStatsPayload = async () => {
    mintStatsReads += 1;
    const stats = baseMintStats();
    stats.pendingCandidates[0].txid = candidateTxid;
    if (
      statsMode === "existing-target" ||
      (statsMode === "target-on-final-read" && mintStatsReads === 2)
    ) {
      stats.targetMintStats.pendingMints = 1;
      stats.targetMintStats.totalMints = 1;
      stats.pendingCandidates.push({ amount: 1_000, txid });
      stats.pendingCandidates.sort((left, right) =>
        left.txid.localeCompare(right.txid),
      );
      stats.pendingCandidateCount = 2;
      stats.pendingCandidateSupply = 2_000;
      stats.pendingMints = 2;
      stats.pendingSupply = 2_000;
      stats.totalMints = stats.confirmedMints + stats.pendingMints;
    }
    if (statsMode === "target-count-without-candidate") {
      stats.targetMintStats.pendingMints = 1;
      stats.targetMintStats.totalMints = 1;
    }
    if (statsMode === "target-candidate-without-count") {
      stats.pendingCandidates.push({ amount: 1_000, txid });
      stats.pendingCandidates.sort((left, right) =>
        left.txid.localeCompare(right.txid),
      );
      stats.pendingCandidateCount = 2;
      stats.pendingCandidateSupply = 2_000;
      stats.pendingMints = 2;
      stats.pendingSupply = 2_000;
      stats.totalMints = stats.confirmedMints + stats.pendingMints;
    }
    if (statsMode === "incomplete") {
      stats.pendingCandidateCount = 33;
      stats.pendingCandidates = Array.from({ length: 32 }, (_value, index) => ({
        amount: 1_000,
        txid: index.toString(16).padStart(64, "0"),
      }));
      stats.pendingCandidatesComplete = false;
      stats.pendingCandidateSupply = 33_000;
      stats.pendingMints = 33;
      stats.pendingSupply = 33_000;
      stats.totalMints = stats.confirmedMints + stats.pendingMints;
    }
    if (statsMode === "witness-missing-final" && mintStatsReads === 2) {
      stats.pendingCandidateCount = 0;
      stats.pendingCandidates = [];
      stats.pendingCandidateSupply = 0;
      stats.pendingMints = 0;
      stats.pendingSupply = 0;
      stats.totalMints = stats.confirmedMints;
    }
    if (statsMode === "witness-reordered-final") {
      stats.pendingCandidateCount = 2;
      stats.pendingCandidates = [
        { amount: 1_000, txid: "4".repeat(64) },
        { amount: 1_000, txid: earlierWitnessTxid },
      ];
      if (mintStatsReads === 2) {
        stats.pendingCandidates.reverse();
      }
      stats.pendingCandidateSupply = 2_000;
      stats.pendingMints = 2;
      stats.pendingSupply = 2_000;
      stats.totalMints = stats.confirmedMints + stats.pendingMints;
    }
    return stats;
  };
  const pendingWorkMintSupplyCapVerifierPayload = isolatedFunction(
    API_PATH,
    "pendingWorkMintSupplyCapVerifierPayload",
    {
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_MAX_SUPPLY: 21_000_000,
      WORK_TOKEN_TICKER: "WORK",
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: registryAddress,
      bitcoinRpc,
      coreMempoolEntryPresent,
      exactCoreTipFromBlockchainInfo,
      exactPendingWorkMintStats,
      fetchTransactionFromBitcoinRpc,
      mapWithConcurrency: async (items, _concurrency, mapper) =>
        Promise.all(items.map(mapper)),
      pendingWorkMintFromHydratedTransaction,
      pendingWorkMintWitnessProof,
      proofIndexCanonicalStateMetaPayload: async () => canonical,
      proofIndexExactlyCoversCoreTip,
      proofIndexOperationalStatusPayload: async () => status(statusHeight),
      proofIndexTokenMintStatsPayload,
    },
  );

  let broadWorkLoads = 0;
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      WORK_TOKEN_ID: workTokenId,
      normalizeTokenScope: (scope) => String(scope).trim().toLowerCase(),
      pendingWorkMintSupplyCapVerifierPayload,
      workTokenPayload: async () => {
        broadWorkLoads += 1;
        return {};
      },
    },
  );
  const fastPayload = await tokenVerifierPayload(
    "livenet",
    workTokenId,
    txid,
  );
  assert.equal(broadWorkLoads, 0);
  assert.equal(canonicalHydrationRequests, 2);
  assert.equal(mintStatsReads, 2);
  assert.equal(mempoolReads.get(earlierWitnessTxid), 2);
  assert.equal(mempoolReads.get(txid), 2);
  assert.equal(fastPayload.provisional, true);
  assert.equal(fastPayload.classification, "supply-cap");
  assert.equal(
    fastPayload.source,
    "proof-indexer-pending-work-supply-cap-verifier",
  );
  assert.equal(fastPayload.items.length, 1);
  assert.equal(fastPayload.items[0].confirmed, false);
  assert.equal(fastPayload.items[0].valid, false);
  assert.equal(fastPayload.items[0].provisionalReason, "supply-cap");
  assert.deepEqual(Array.from(fastPayload.supplyCapWitnessTxids), [
    earlierWitnessTxid,
  ]);

  statsMode = "existing-target";
  mintStatsReads = 0;
  mempoolReads.clear();
  const existingTargetPayload =
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    );
  assert.equal(existingTargetPayload?.classification, "supply-cap");
  assert.deepEqual(
    Array.from(existingTargetPayload?.supplyCapWitnessTxids ?? []),
    [earlierWitnessTxid],
  );

  for (const inconsistentMode of [
    "target-count-without-candidate",
    "target-candidate-without-count",
  ]) {
    statsMode = inconsistentMode;
    mintStatsReads = 0;
    mempoolReads.clear();
    assert.equal(
      await pendingWorkMintSupplyCapVerifierPayload(
        "livenet",
        workTokenId,
        txid,
      ),
      null,
    );
  }

  statsMode = "stable";
  statusHeight = tipHeight - 1;
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );

  statusHeight = tipHeight;
  protocolMessage = `pwt1:send:${workTokenId}:1000`;
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );
  assert.equal(mintStatsReads, 0);

  protocolMessage = mintMessage;
  statsMode = "target-on-final-read";
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );
  assert.equal(mintStatsReads, 2);

  statsMode = "stable";
  candidateTxid = earlierWitnessTxid;
  staleWitness = true;
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );

  staleWitness = false;
  candidateTxid = laterWitnessTxid;
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );
  assert.equal(mempoolReads.has(laterWitnessTxid), false);

  candidateTxid = earlierWitnessTxid;
  witnessDropsOnFinalCheck = true;
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );
  assert.equal(mempoolReads.get(earlierWitnessTxid), 2);

  witnessDropsOnFinalCheck = false;
  statsMode = "incomplete";
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );
  assert.equal(mempoolReads.has(earlierWitnessTxid), false);

  statsMode = "witness-missing-final";
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );
  assert.equal(mintStatsReads, 2);

  statsMode = "witness-reordered-final";
  mintStatsReads = 0;
  mempoolReads.clear();
  assert.equal(
    await pendingWorkMintSupplyCapVerifierPayload(
      "livenet",
      workTokenId,
      txid,
    ),
    null,
  );
  assert.equal(mintStatsReads, 2);
});

check("pending token verifier classifies a mint beyond ordered supply as invalid", async () => {
  const txid = "6".repeat(64);
  const tokenId = "d".repeat(64);
  const registryAddress = "work-registry";
  const transaction = { txid, vout: [{ value: 1_000 }] };
  const state = {
    indexedAt: "2026-07-15T01:10:00.000Z",
    indexedThroughBlock: 958_079,
    mints: [
      {
        amount: 20_999_000,
        confirmed: true,
        tokenId,
        txid: "1".repeat(64),
      },
      {
        amount: 1_000,
        confirmed: false,
        tokenId,
        txid: "2".repeat(64),
      },
    ],
    tokens: [{
      maxSupply: 21_000_000,
      mintPriceSats: 1_000,
      registryAddress,
      ticker: "WORK",
      tokenId,
    }],
  };
  const tokenVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "tokenVerifierDeterministicInvalidReason",
    {
      TOKEN_CREATION_PRICE_SATS: 546,
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      decodedProtocolMessages: () => [`pwt1:mint:${tokenId}:1000`],
      fetchTransactionFromBitcoinRpc: async () => transaction,
      numericValue: (value) => Number(value) || 0,
      parseTokenPayload: () => ({ amount: 1_000, kind: "mint", tokenId }),
      tokenIndexAddressForNetwork: () => "token-index",
      tokenListingForVerifier: () => null,
      tokenPaymentAmountBeforeProtocol: () => 1_000,
      transactionBlockHeight: () => 0,
      transactionConfirmed: () => false,
      transactionTxid: (tx) => tx.txid,
    },
  );
  const expectedReason =
    "WORK mint exceeds max supply: 20,999,000 confirmed + 1,000 pending + 1,000 requested > 21,000,000 max.";
  assert.equal(
    await tokenVerifierDeterministicInvalidReason(
      "livenet",
      state,
      txid,
      false,
    ),
    expectedReason,
  );

  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      WORK_TOKEN_ID: tokenId,
      cachedInternalVerifierState: async (_key, loader) => loader(),
      completeTokenVerifierState: async () => state,
      decodedProtocolMessages: () => [],
      normalizeTokenScope: () => tokenId,
      pendingCoreWorkMarketplaceVerifierContext: async () => null,
      pendingWorkMintSupplyCapVerifierPayload: async () => null,
      pruneInternalVerifierStateCache: () => {},
      tokenPayload: async () => state,
      tokenVerifierDeterministicInvalidReason,
      tokenVerifierItemsFromState: () => [],
      verifierBalanceSnapshot: () => null,
      workTokenPayload: async () => state,
    },
  );
  const payload = await tokenVerifierPayload("livenet", tokenId, txid);
  assert.equal(payload.source, "full-ordered-credit-verifier");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].kind, "token-event-invalid");
  assert.equal(payload.items[0].valid, false);
  assert.equal(payload.items[0].confirmed, false);
  assert.equal(payload.items[0].reason, expectedReason);
});

check("a stale token verifier absence remains unresolved", async () => {
  const txid = "7".repeat(64);
  const blockHash = "a".repeat(64);
  const previousBlockHash = "b".repeat(64);
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      POWB_TOKEN_ID: "powb",
      WORK_TOKEN_ID: "work",
      cachedInternalVerifierState: async () => ({
        blockHash,
        coverageHeight: 101,
        indexedAt: "2026-07-03T00:00:00.000Z",
        indexedThroughBlock: 100,
        previousBlockHash,
      }),
      completeTokenVerifierState: async () => ({ coverageHeight: 101 }),
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pendingWorkMintSupplyCapVerifierPayload: async () => null,
      pruneInternalVerifierStateCache: () => {},
      tokenPayload: async () => ({}),
      tokenVerifierDeterministicInvalidReason: async () => "",
      tokenVerifierItemsFromState: () => [],
      verifierBalanceSnapshot: () => null,
      workTokenPayload: async () => ({}),
    },
  );
  await rejection(
    tokenVerifierPayload("livenet", "work", txid, {
      blockHash,
      blockHeight: 101,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 && error.details?.code === "TOKEN_VERIFIER_UNRESOLVED",
    "Stale absence must not be converted into an invalid token event",
  );
});

check("a stale ID verifier absence remains unresolved", async () => {
  const txid = "8".repeat(64);
  const blockHash = "c".repeat(64);
  const previousBlockHash = "d".repeat(64);
  const idVerifierPayload = isolatedFunction(API_PATH, "idVerifierPayload", {
    INTERNAL_VERIFIER_STATE_CACHE: new Map(),
    cachedInternalVerifierState: async () => ({
      blockHash,
      coverageHeight: 101,
      previousBlockHash,
      state: { activity: [], sales: [] },
      transactions: [{ confirmed: true, height: 101, txid }],
    }),
    completeIdVerifierStateBundle: async () => ({ coverageHeight: 101 }),
    fetchTransactionFromBitcoinRpc: async () => ({
      confirmed: true,
      height: 101,
      txid,
    }),
    idVerifierDeterministicInvalidReason: async () => "",
    idVerifierItemsFromState: () => [],
    indexedThroughBlockFromTransactions: () => 101,
    pruneInternalVerifierStateCache: () => {},
    transactionBlockHeight: (tx) => tx.height,
    transactionConfirmed: (tx) => tx.confirmed === true,
    transactionTxid: (tx) => tx.txid,
  });
  await rejection(
    idVerifierPayload("livenet", txid, {
      blockHash,
      blockHeight: 101,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 && error.details?.code === "ID_VERIFIER_UNRESOLVED",
    "Stale absence must not be converted into a synthetic invalid ID event",
  );
});

check("confirmed verifiers ignore a same-txid copy from the wrong block", async () => {
  const requiredBlockHeight = 101;
  const wrongBlockHeight = 100;
  const tokenTxid = "6".repeat(64);
  const idTxid = "5".repeat(64);
  const blockHash = "4".repeat(64);
  const previousBlockHash = "3".repeat(64);
  let decodedWrongBlockTransactions = 0;
  let rpcReads = 0;
  const wrongBlockTransaction = (txid) => ({
    confirmed: true,
    height: wrongBlockHeight,
    txid,
    // Deliberately malformed and fee-less. Confirmed invalidity may only be
    // decided from the exact transaction in the requested canonical block.
    vout: [{ scriptpubkey_type: "op_return", scriptpubkey: "6a01ff" }],
  });
  const transactionTxid = (tx) => String(tx?.txid ?? "").toLowerCase();
  const transactionBlockHeight = (tx) => Number(tx?.height ?? 0);
  const transactionConfirmed = (tx) => tx?.confirmed === true;
  const decodedProtocolMessages = () => {
    decodedWrongBlockTransactions += 1;
    return ["malformed"];
  };
  const fetchTransactionFromBitcoinRpc = async () => {
    rpcReads += 1;
    return wrongBlockTransaction(tokenTxid);
  };

  const tokenVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "tokenVerifierDeterministicInvalidReason",
    {
      decodedProtocolMessages,
      fetchTransactionFromBitcoinRpc,
      transactionBlockHeight,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const tokenState = {
    blockHash,
    canonicalCoverage: true,
    coverageHeight: requiredBlockHeight,
    indexedThroughBlock: requiredBlockHeight,
    previousBlockHash,
    transactions: [wrongBlockTransaction(tokenTxid)],
  };
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      cachedInternalVerifierState: async (_key, loader) => loader(),
      completeTokenVerifierState: async () => tokenState,
      decodedProtocolMessages,
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pendingWorkMintSupplyCapVerifierPayload: async () => null,
      pruneInternalVerifierStateCache: () => {},
      tokenVerifierDeterministicInvalidReason,
      tokenVerifierItemsFromState: () => [],
      transactionBlockHeight,
      transactionTxid,
    },
  );
  await rejection(
    tokenVerifierPayload("livenet", "work", tokenTxid, {
      blockHash,
      blockHeight: requiredBlockHeight,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 &&
      error.details?.code === "TOKEN_VERIFIER_UNRESOLVED",
    "A token transaction from the wrong block became deterministic invalidity",
  );

  const idVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "idVerifierDeterministicInvalidReason",
    {
      decodedProtocolMessages,
      fetchTransactionFromBitcoinRpc,
      transactionBlockHeight,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const idBundle = {
    blockHash,
    canonicalCoverage: true,
    coverageHeight: requiredBlockHeight,
    state: { activity: [], sales: [] },
    previousBlockHash,
    transactions: [wrongBlockTransaction(idTxid)],
  };
  const idVerifierPayload = isolatedFunction(API_PATH, "idVerifierPayload", {
    INTERNAL_VERIFIER_STATE_CACHE: new Map(),
    cachedInternalVerifierState: async (_key, loader) => loader(),
    completeIdVerifierStateBundle: async () => idBundle,
    decodedProtocolMessages,
    idVerifierDeterministicInvalidReason,
    idVerifierItemsFromState: () => [],
    pruneInternalVerifierStateCache: () => {},
    transactionBlockHeight,
    transactionTxid,
  });
  await rejection(
    idVerifierPayload("livenet", idTxid, {
      blockHash,
      blockHeight: requiredBlockHeight,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 &&
      error.details?.code === "ID_VERIFIER_UNRESOLVED",
    "An ID transaction from the wrong block became deterministic invalidity",
  );
  assert.equal(decodedWrongBlockTransactions, 0);
  assert.equal(rpcReads, 0);
});

check("canonical buy recovery counts price and one registry close only", async () => {
  const txid = "b".repeat(64);
  const listingId = "c".repeat(64);
  const tokenId = "d".repeat(64);
  const priceSats = 12_000;
  const anchorRefundSats = 330;
  const paidSats = priceSats + 546 + anchorRefundSats;
  const blockHash = "e".repeat(64);
  const previousBlockHash = "f".repeat(64);
  const canonicalRecoveryItemsForTx = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRecoveryItemsForTx",
    {
      NETWORK: "livenet",
      PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
      PENDING_VERIFIER_TIMEOUT_MS: 5_000,
      canonicalKindForSourceLabel: isolatedFunction(
        BACKFILL_PATH,
        "canonicalKindForSourceLabel",
      ),
      canonicalRecoveryItemMatchesTxid: isolatedFunction(
        BACKFILL_PATH,
        "canonicalRecoveryItemMatchesTxid",
      ),
      disambiguateDuplicateProtocolItems: isolatedFunction(
        BACKFILL_PATH,
        "disambiguateDuplicateProtocolItems",
      ),
      endpoint: () => "http://127.0.0.1/internal/token-verifier",
      invalidProtocolItem: isolatedFunction(BACKFILL_PATH, "invalidProtocolItem"),
      rawProtocolItemMatchesCanonical: isolatedFunction(
        BACKFILL_PATH,
        "rawProtocolItemMatchesCanonical",
      ),
      reservedBondCreditViolationReason: () => "",
      rawProtocolItemsForTx: () => [
        {
          amount: 10,
          amountSats: paidSats,
          kind: "token-sale",
          listingId,
          paidSats,
          protocol: "pwt1",
          tokenId,
          txid,
        },
      ],
      readJson: async () => ({
        blockHash,
        indexedThroughBlock: 101,
        items: [
          {
            amount: 10,
            amountSats: paidSats,
            anchorRefundSats,
            blockHeight: 101,
            confirmed: true,
            kind: "token-sale",
            listingId,
            paidSats,
            priceSats,
            tokenId,
            txid,
          },
          {
            amount: 10,
            amountSats: paidSats,
            anchorRefundSats,
            closedBlockHeight: 101,
            closedTxid: txid,
            confirmed: true,
            kind: "token-listing-closed",
            listingId,
            paidSats,
            tokenId,
          },
        ],
        network: "livenet",
        previousBlockHash,
        source: "canonical-block-scan-db-core-credit-verifier",
        txid,
      }),
      recoveryEndpointSpecs: () => [
        {
          label: "token-verifier",
          params: { asset: tokenId, txid },
          path: "/api/v1/internal/token-verifier",
        },
      ],
      sourceLabelForProtocolItem: isolatedFunction(
        BACKFILL_PATH,
        "sourceLabelForProtocolItem",
      ),
      tokenProtocolIntegrityInvalidItem: (item) => item,
    },
  );
  const recovered = await canonicalRecoveryItemsForTx(
    {
      _powBlockHash: blockHash,
      _powPreviousBlockHash: previousBlockHash,
      height: 101,
      txid,
    },
    [{ prefix: "pwt1:", text: "pwt1:buy5:fixture" }],
  );
  const sales = recovered.filter(({ item }) => item.kind === "token-sale");
  const closes = recovered.filter(
    ({ item }) => item.kind === "token-listing-closed",
  );
  assert.equal(sales.length, 1);
  assert.equal(closes.length, 1);
  assert.equal(sales[0].item.amountSats, priceSats);
  assert.equal(closes[0].item.amountSats, 546);
  assert.equal(
    sales[0].item.amountSats + closes[0].item.amountSats,
    priceSats + 546,
  );
  assert.notEqual(
    sales[0].item.amountSats + closes[0].item.amountSats,
    paidSats,
  );
});

check("pending PWM envelopes survive unresolved staged verifier companions", async () => {
  const txid = "9".repeat(64);
  const tokenId = "8".repeat(64);
  let pendingVerifierTimeoutMs = 0;
  const canonicalRecoveryItemsForTx = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRecoveryItemsForTx",
    {
      NETWORK: "livenet",
      PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
      PENDING_VERIFIER_TIMEOUT_MS: 5_000,
      canonicalKindForSourceLabel: isolatedFunction(
        BACKFILL_PATH,
        "canonicalKindForSourceLabel",
      ),
      canonicalRecoveryItemMatchesTxid: isolatedFunction(
        BACKFILL_PATH,
        "canonicalRecoveryItemMatchesTxid",
      ),
      disambiguateDuplicateProtocolItems: isolatedFunction(
        BACKFILL_PATH,
        "disambiguateDuplicateProtocolItems",
      ),
      endpoint: () => "http://127.0.0.1/internal/token-verifier",
      invalidProtocolItem: isolatedFunction(BACKFILL_PATH, "invalidProtocolItem"),
      rawProtocolItemMatchesCanonical: isolatedFunction(
        BACKFILL_PATH,
        "rawProtocolItemMatchesCanonical",
      ),
      rawProtocolItemsForTx: () => [
        {
          confirmed: false,
          kind: "inception-bond",
          protocol: "pwm1",
          status: "pending",
          txid,
        },
        {
          amount: 1_000,
          confirmed: false,
          kind: "token-transfer",
          protocol: "pwt1",
          status: "pending",
          tokenId,
          txid,
        },
      ],
      readJson: async (_url, options) => {
        pendingVerifierTimeoutMs = Number(options?.timeoutMs ?? 0);
        const error = new Error("ordered verifier unresolved");
        error.name = "AbortError";
        throw error;
      },
      recoveryEndpointSpecs: () => [
        {
          label: "token-verifier",
          params: { asset: tokenId, txid },
          path: "/api/v1/internal/token-verifier",
        },
      ],
      reservedBondCreditViolationReason: () => "",
      sourceLabelForProtocolItem: isolatedFunction(
        BACKFILL_PATH,
        "sourceLabelForProtocolItem",
      ),
      tokenProtocolIntegrityInvalidItem: (item) => item,
    },
  );
  const messages = [
    { prefix: "pwm1:", text: "pwm1:m:incb" },
    { prefix: "pwt1:", text: `pwt1:send:${tokenId}:1000:fixture` },
  ];
  const pending = await canonicalRecoveryItemsForTx(
    { height: 0, txid },
    messages,
    { pendingVerifierTimeoutMs: 30_000 },
  );
  assert.equal(pendingVerifierTimeoutMs, 30_000);
  assert.equal(
    JSON.stringify(pending.map(({ item }) => item.kind)),
    JSON.stringify(["inception-bond"]),
  );
  assert.equal(pending[0].item.confirmed, false);
  assert.equal(pending[0].item.valid, undefined);

  await rejection(
    canonicalRecoveryItemsForTx(
      {
        _powBlockHash: "a".repeat(64),
        _powPreviousBlockHash: "b".repeat(64),
        height: 101,
        txid,
      },
      messages,
    ),
    (error) => error.name === "AbortError",
    "A confirmed block event bypassed an unresolved canonical verifier",
  );
});

check("sealed credit listings keep the original sale-ticket anchor", () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  const tokenListingAnchorOutpoint = isolatedFunction(
    API_PATH,
    "tokenListingAnchorOutpoint",
    { TOKEN_LISTING_ANCHOR_TYPE: "sale-ticket-v1" },
  );
  const anchor = tokenListingAnchorOutpoint({
    listingId,
    saleAuthorization: {
      anchorType: "sale-ticket-v1",
      anchorVout: 2,
    },
    sealConfirmed: true,
    sealTxid,
  });
  assert.equal(anchor.txid, listingId);
  assert.equal(anchor.vout, 2);
});

check("credit market logs keep one deterministic order across UI and index sources", () => {
  const uiConfirmed = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenMarketLogItemConfirmed",
  );
  const uiKindRank = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenMarketLogItemKindRank",
  );
  const uiCompare = isolatedTypeScriptFunction(
    APP_PATH,
    "compareTokenMarketLogItems",
    {
      tokenMarketLogItemConfirmed: uiConfirmed,
      tokenMarketLogItemKindRank: uiKindRank,
    },
  );

  const apiCreatedAt = isolatedFunction(
    API_PATH,
    "tokenHistoryPageItemCreatedAt",
  );
  const apiIsMarketLogItem = isolatedFunction(
    API_PATH,
    "tokenHistoryPageItemIsMarketLogItem",
  );
  const apiConfirmed = isolatedFunction(
    API_PATH,
    "tokenHistoryPageItemConfirmed",
  );
  const apiKindRank = isolatedFunction(
    API_PATH,
    "tokenHistoryPageItemKindRank",
  );
  const apiTxid = isolatedFunction(API_PATH, "tokenHistoryPageItemTxid");
  const apiCompare = isolatedFunction(
    API_PATH,
    "compareTokenHistoryPageItems",
    {
      tokenHistoryPageItemConfirmed: apiConfirmed,
      tokenHistoryPageItemCreatedAt: apiCreatedAt,
      tokenHistoryPageItemIsMarketLogItem: apiIsMarketLogItem,
      tokenHistoryPageItemKindRank: apiKindRank,
      tokenHistoryPageItemTxid: apiTxid,
    },
  );

  const readerCreatedAt = isolatedFunction(
    READER_PATH,
    "tokenHistoryItemCreatedAt",
  );
  const readerIsMarketLogItem = isolatedFunction(
    READER_PATH,
    "tokenHistoryItemIsMarketLogItem",
  );
  const readerConfirmed = isolatedFunction(
    READER_PATH,
    "tokenHistoryItemConfirmed",
  );
  const readerKindRank = isolatedFunction(
    READER_PATH,
    "tokenHistoryItemKindRank",
  );
  const readerTxid = isolatedFunction(READER_PATH, "tokenHistoryItemTxid");
  const readerCompare = isolatedFunction(
    READER_PATH,
    "compareTokenHistoryMarketItems",
    {
      tokenHistoryItemConfirmed: readerConfirmed,
      tokenHistoryItemCreatedAt: readerCreatedAt,
      tokenHistoryItemIsMarketLogItem: readerIsMarketLogItem,
      tokenHistoryItemKindRank: readerKindRank,
      tokenHistoryItemTxid: readerTxid,
    },
  );

  const sameTime = "2026-07-15T09:20:03.000Z";
  const newerTime = "2026-07-15T09:20:04.000Z";
  const lifecycleTxid = "a".repeat(64);
  const confirmedListingTxid = "c".repeat(64);
  const pendingListingTxid = "f".repeat(64);
  const newerListingTxid = "0".repeat(64);
  const items = [
    {
      createdAt: sameTime,
      kind: "closed-listing",
      closedListing: {
        closedAt: sameTime,
        closedConfirmed: true,
        closedTxid: lifecycleTxid,
        listingId: "1".repeat(64),
      },
      txid: lifecycleTxid,
    },
    {
      createdAt: sameTime,
      kind: "sale",
      sale: { confirmed: true, createdAt: sameTime, txid: lifecycleTxid },
      txid: lifecycleTxid,
    },
    {
      createdAt: sameTime,
      kind: "listing",
      listing: {
        confirmed: true,
        createdAt: sameTime,
        listingId: confirmedListingTxid,
      },
      txid: confirmedListingTxid,
    },
    {
      createdAt: sameTime,
      kind: "listing",
      listing: {
        confirmed: false,
        createdAt: sameTime,
        listingId: pendingListingTxid,
      },
      txid: pendingListingTxid,
    },
    {
      createdAt: newerTime,
      kind: "listing",
      listing: {
        confirmed: false,
        createdAt: newerTime,
        listingId: newerListingTxid,
      },
      txid: newerListingTxid,
    },
  ];
  const expected = [
    `listing:${newerListingTxid}`,
    `listing:${confirmedListingTxid}`,
    `sale:${lifecycleTxid}`,
    `closed-listing:${lifecycleTxid}`,
    `listing:${pendingListingTxid}`,
  ];
  const signatures = (records, compare) =>
    records
      .slice()
      .sort(compare)
      .map((item) => `${item.kind}:${item.txid}`);
  const permutations = (records) => {
    if (records.length <= 1) {
      return [records];
    }
    return records.flatMap((record, index) =>
      permutations(records.filter((_item, itemIndex) => itemIndex !== index)).map(
        (tail) => [record, ...tail],
      ),
    );
  };

  for (const permutation of permutations(items)) {
    assert.deepEqual(signatures(permutation, uiCompare), expected);
    assert.deepEqual(signatures(permutation, apiCompare), expected);
    assert.deepEqual(signatures(permutation, readerCompare), expected);
  }
});

check("credit market log SQL canonicalizes listing lifecycles before pagination", () => {
  const canonicalSql = isolatedFunction(
    READER_PATH,
    "tokenHistoryCanonicalMarketEventsSql",
  );
  const sql = canonicalSql("market-log", "e.network = $1");
  const overlaySource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexTokenMarketHistoryOverlayPayload",
  );

  assert.match(
    sql,
    /ROW_NUMBER\(\) OVER \([\s\S]*PARTITION BY[\s\S]*'listing:'[\s\S]*listingId[\s\S]*canonical_history_rank/iu,
  );
  assert.match(
    sql,
    /WHEN e\.kind = ANY\(ARRAY\['token-listings','token-listing'\]::text\[\]\) THEN 0[\s\S]*WHEN e\.kind = 'token-listing-sealed' THEN 1/iu,
  );
  assert.match(
    sql,
    /canonical_market_events AS \([\s\S]*WHERE canonical_history_rank = 1/iu,
  );
  assert.match(
    overlaySource,
    /canonical_market_metadata AS \([\s\S]*count\(\*\) AS total_count[\s\S]*FROM canonical_market_events/iu,
  );
  assert.match(
    overlaySource,
    /FROM canonical_market_metadata metadata[\s\S]*LEFT JOIN LATERAL \([\s\S]*FROM canonical_market_events[\s\S]*history_item_confirmed DESC[\s\S]*history_item_txid DESC[\s\S]*history_item_kind_rank ASC[\s\S]*LIMIT \$\$\{limitParam\}[\s\S]*OFFSET \$\$\{offsetParam\}/iu,
  );
  assert.doesNotMatch(
    overlaySource,
    /await pool\.query\([\s\S]*await pool\.query/iu,
  );
  assert.match(overlaySource, /await ledgerSnapshotMetadata\(/u);
  assert.doesNotMatch(overlaySource, /await ledgerSnapshot\(/u);
});

check("exact dropped market misses are terminal without loading broad history", async () => {
  const txid = "d".repeat(64);
  const pagination = {
    limit: 20,
    offset: 0,
    page: 0,
    query: txid,
    snapshotId: "",
  };
  const snapshot = {
    generated_at: "2026-07-16T12:00:00.000Z",
    indexed_through_block: 958_363,
    snapshot_id: "current",
  };
  let disposition = "terminal-nonmarket";
  let needles = [txid];
  const sqlReads = [];
  const proofIndexTokenMarketHistoryOverlayPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenMarketHistoryOverlayPayload",
    {
      compareTokenHistoryMarketItems: () => 0,
      historyCursor: (_snapshotId, offset) => String(offset),
      historyPaginationFromSearch: () => pagination,
      ledgerSnapshotMetadata: async () => snapshot,
      proofIndexPool: () => ({
        async query(sql, params) {
          sqlReads.push({ params: Array.from(params), sql: String(sql) });
          return {
            rows: [
              {
                history_indexed_through_block: null,
                history_query_disposition: disposition,
                history_total_count: 0,
              },
            ],
          };
        },
      }),
      tokenHistoryCanonicalMarketEventsSql: () => `
        WITH canonical_market_events AS (
          SELECT NULL::integer AS block_height WHERE false
        )
      `,
      tokenHistoryFilterNeedles: () => needles,
      tokenHistoryItemFromMarketEventPayload: () => null,
      tokenHistoryMarketEventKinds: () => [
        "token-listing",
        "token-sale",
        "token-listing-closed",
      ],
      tokenHistorySafeKind: () => "market-log",
      tokenMarketEventRowPayload: (row) => row,
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );

  const terminalPage = await proofIndexTokenMarketHistoryOverlayPayload(
    "livenet",
    "work",
    "market-log",
    new URLSearchParams({ q: txid }),
    { pagination },
  );
  assert.equal(terminalPage.totalCount, 0);
  assert.deepEqual(terminalPage.items, []);
  assert.equal(terminalPage.queryDisposition, "terminal-nonmarket");
  assert.equal(terminalPage.indexedThroughBlock, undefined);
  assert.equal(sqlReads.length, 1);
  assert.match(sqlReads[0].sql, /count\(\*\) = cardinality\(\$\d+::text\[\]\)/u);
  assert.match(
    sqlReads[0].sql,
    /bool_and\([\s\S]*terminal_tx\.status IN \('dropped', 'orphaned'\)/u,
  );
  assert.match(
    sqlReads[0].sql,
    /metadata\.query_disposition AS history_query_disposition/u,
  );
  assert.ok(
    sqlReads[0].params.some(
      (value) => Array.isArray(value) && value.length === 1 && value[0] === txid,
    ),
  );

  disposition = null;
  sqlReads.length = 0;
  assert.equal(
    await proofIndexTokenMarketHistoryOverlayPayload(
      "livenet",
      "work",
      "market-log",
      new URLSearchParams({ q: txid }),
      { pagination },
    ),
    null,
  );
  assert.equal(sqlReads.length, 1);

  disposition = null;
  needles = [txid, "seller-name"];
  sqlReads.length = 0;
  assert.equal(
    await proofIndexTokenMarketHistoryOverlayPayload(
      "livenet",
      "work",
      "market-log",
      new URLSearchParams({ q: txid }),
      { pagination },
    ),
    null,
  );
  assert.doesNotMatch(sqlReads[0].sql, /bool_and\(/u);

  let embeddedSnapshotReads = 0;
  const proofIndexTokenHistoryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenHistoryPayload",
    {
      ledgerSnapshotMetadata: async () => snapshot,
      ledgerSnapshotWithPayload: async () => {
        embeddedSnapshotReads += 1;
        throw new Error("broad embedded history must not load");
      },
      proofIndexPool: () => ({}),
      proofIndexTokenHistoryReadEligibility: () => ({
        eligible: true,
        kind: "market-log",
        pagination,
        scope: "work",
      }),
      proofIndexTokenMarketHistoryOverlayPayload: async () => terminalPage,
      tokenHistoryFilterNeedles: () => [txid],
      tokenHistoryMarketEventKinds: () => ["token-sale"],
      tokenHistoryPageWithScanCoverage: (page) => page,
    },
  );
  const exactPage = await proofIndexTokenHistoryPayload(
    "livenet",
    "work",
    "market-log",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(exactPage.queryDisposition, "terminal-nonmarket");
  assert.equal(embeddedSnapshotReads, 0);

  const apiSource = topLevelFunctionSource(API_PATH, "tokenHistoryPayload");
  assert.equal(
    (apiSource.match(/queryDisposition === "terminal-nonmarket"/gu) ?? [])
      .length,
    2,
  );
  assert.ok(
    apiSource.indexOf("proofIndexTokenMarketHistoryOverlayPayload") <
      apiSource.indexOf("confirmedTransactionsForTxids"),
  );
  assert.match(
    topLevelFunctionSource(
      API_PATH,
      "tokenHistoryPageWithCanonicalCreditValueOverlay",
    ),
    /queryDisposition === "terminal-nonmarket"[\s\S]*totalCount[\s\S]*items[\s\S]*return page/iu,
  );
});

check("dropped market events cannot re-enter history or close active listings", () => {
  const overlaySource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexTokenMarketHistoryOverlayPayload",
  );
  const exactActiveListingSource = topLevelFunctionSource(
    READER_PATH,
    "exactActiveTokenListingHistoryPage",
  );
  const creditListingsSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexCreditListingsPayload",
  );
  const filterClosedListingSource = topLevelFunctionSource(
    READER_PATH,
    "filterClosedTokenListingHistoryPage",
  );
  const marketSummarySource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexTokenMarketSummaryOverlayPayload",
  );
  const walletOverlaySource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexWalletTokenOverlayPayload",
  );
  const closeOutspendSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexTokenListingCloseOutspendPayload",
  );

  assert.match(
    overlaySource,
    /const conditions = \[[\s\S]*e\.valid = true[\s\S]*e\.status IN \('confirmed', 'pending'\)[\s\S]*e\.kind = ANY/iu,
  );
  assert.equal(
    (overlaySource.match(/close_event\.status IN \('confirmed', 'pending'\)/gu) ?? [])
      .length,
    2,
  );
  assert.match(
    closeOutspendSource,
    /e\.valid = true[\s\S]*e\.status IN \('confirmed', 'pending'\)[\s\S]*token-listing-closed/iu,
  );
  assert.match(
    filterClosedListingSource,
    /e\.kind = ANY\(\$2::text\[\]\)[\s\S]*e\.status IN \('confirmed', 'pending'\)[\s\S]*listingId/iu,
  );
  assert.match(
    exactActiveListingSource,
    /e\.valid = true[\s\S]*e\.status IN \('confirmed', 'pending'\)[\s\S]*e\.kind = ANY\(ARRAY\['token-listing-closed','token-sale'\]/iu,
  );
  assert.match(
    exactActiveListingSource,
    /terminal_event\.txid = ANY\(\$2::text\[\]\)[\s\S]*terminal_event\.status IN \('dropped', 'orphaned'\)[\s\S]*terminal_event\.valid = true[\s\S]*terminal_event\.status IN \('confirmed', 'pending'\)[\s\S]*terminal_event\.kind IN \('token-listing-closed', 'token-sale'\)/iu,
  );
  assert.match(
    marketSummarySource,
    /const conditions = \[[\s\S]*e\.valid = true[\s\S]*e\.status IN \('confirmed', 'pending'\)[\s\S]*e\.kind = ANY/iu,
  );
  assert.match(
    creditListingsSource,
    /e\.valid = true[\s\S]*e\.status IN \('confirmed', 'pending'\)[\s\S]*e\.kind = ANY\(ARRAY\['token-sale','token-listing-closed'\]/iu,
  );
  assert.match(
    walletOverlaySource,
    /close_event\.valid = true[\s\S]*close_event\.status IN \('confirmed', 'pending'\)[\s\S]*close_event\.kind = ANY\(ARRAY\['token-listing-closed','token-sale'\]/iu,
  );
});

check("canonical market listings retain original time with current seal metadata", () => {
  const normalizedLowerText = (value) =>
    String(value ?? "").trim().toLowerCase();
  const objectRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const validTxid = (value) =>
    /^[0-9a-f]{64}$/u.test(String(value ?? "").trim().toLowerCase());
  const sealPatch = isolatedFunction(
    READER_PATH,
    "tokenMarketListingSealPatch",
    { normalizedLowerText, objectRecord, validTxid },
  );
  const tokenMarketEventRowPayload = isolatedFunction(
    READER_PATH,
    "tokenMarketEventRowPayload",
    {
      eventRowPayload: (row) => row.payload,
      normalizeEventPayload: (value) => value,
      objectRecord,
      tokenMarketListingSealPatch: sealPatch,
    },
  );
  const tokenListingFromEventPayload = isolatedFunction(
    READER_PATH,
    "tokenListingFromEventPayload",
    {
      dateIso: (value) => value ? new Date(value).toISOString() : undefined,
      isWorkTokenId: () => false,
      rowNumber: (value, key) => Number(value?.[key] ?? 0),
      tokenMarketNumbersFromTags: () => ({ amount: 0, priceSats: 0, ticker: "" }),
      tokenRegistryAddressFromPayload: () => "bc1registry",
      workAmountProjection: () => null,
    },
  );
  const tokenHistoryItemFromMarketEventPayload = isolatedFunction(
    READER_PATH,
    "tokenHistoryItemFromMarketEventPayload",
    {
      activeTokenListingHistoryItem: () => true,
      tokenListingFromEventPayload,
    },
  );

  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  const originalAt = "2026-07-09T15:54:41.000Z";
  const sealAt = "2026-07-09T17:14:17.000Z";
  const saleAuthorization = {
    anchorTxid: listingId,
    anchorType: "sale-ticket-v1",
    signature: "signed-current-authorization",
  };
  const payload = tokenMarketEventRowPayload(
    {
      listing_payload: {
        dataBytes: 321,
        saleAuthorization,
        sealAt,
        sealConfirmed: true,
        sealMinerFeeCanonical: true,
        sealMinerFeeSats: 777,
        sealTxid,
        status: "sealing",
      },
      payload: {
        confirmed: true,
        createdAt: originalAt,
        kind: "token-listing",
        listingId,
        registryAddress: "bc1registry",
        saleAuthorization: {},
        sellerAddress: "bc1seller",
        ticker: "TEST",
        tokenId: "c".repeat(64),
        txid: listingId,
      },
    },
    "livenet",
  );
  const item = tokenHistoryItemFromMarketEventPayload(payload, "market-log");

  assert.equal(item.kind, "listing");
  assert.equal(item.createdAt, originalAt);
  assert.equal(item.listing.createdAt, originalAt);
  assert.equal(item.listing.sealAt, sealAt);
  assert.equal(item.listing.sealTxid, sealTxid);
  assert.equal(item.listing.sealConfirmed, true);
  assert.equal(item.listing.sealDataBytes, 321);
  assert.equal(item.listing.sealMinerFeeCanonical, true);
  assert.equal(item.listing.sealMinerFeeSats, 777);
  assert.equal(item.listing.status, "sealing");
  assert.deepEqual(item.listing.saleAuthorization, saleAuthorization);
});

check("credit market log refreshes retain canonical pages and normalize nested rows", () => {
  const remotePageForView = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenMarketLogRemotePageForView",
  );
  const page = { items: [{ kind: "sale", txid: "a".repeat(64) }] };
  const remote = { page, viewKey: "livenet:work:0:6" };
  assert.equal(remotePageForView(remote, "livenet:work:0:6"), page);
  assert.equal(remotePageForView(remote, "livenet:other:0:6"), undefined);
  assert.equal(remotePageForView(remote, "livenet:work:1:6"), undefined);

  const normalizeTokenMarketLogItem = isolatedTypeScriptFunction(
    APP_PATH,
    "normalizeTokenMarketLogItem",
    {
      normalizeTokenAmountRecord: (record) => ({ ...record, normalized: true }),
      normalizeTokenListingRecord: (record) =>
        record?.listingId ? { ...record, normalized: true } : null,
    },
  );
  const listingId = "b".repeat(64);
  const closedTxid = "c".repeat(64);
  const listing = normalizeTokenMarketLogItem({
    createdAt: "old",
    kind: "listing",
    listing: { createdAt: "new", listingId },
    txid: "old",
  });
  assert.equal(listing.createdAt, "new");
  assert.equal(listing.listing.normalized, true);
  assert.equal(listing.txid, listingId);
  const closed = normalizeTokenMarketLogItem({
    closedListing: {
      closedAt: "closed",
      closedTxid,
      createdAt: "listed",
      listingId,
    },
    createdAt: "old",
    kind: "closed-listing",
    txid: "old",
  });
  assert.equal(closed.createdAt, "closed");
  assert.equal(closed.closedListing.normalized, true);
  assert.equal(closed.txid, closedTxid);
  const sale = normalizeTokenMarketLogItem({
    createdAt: "old",
    kind: "sale",
    sale: { createdAt: "sale", txid: closedTxid },
    txid: "old",
  });
  assert.equal(sale.createdAt, "sale");
  assert.equal(sale.sale.normalized, true);
  assert.equal(sale.txid, closedTxid);
  assert.equal(
    normalizeTokenMarketLogItem({ kind: "sale", sale: null }),
    null,
  );

  const statusLabel = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenMarketListingStatusLabel",
    {
      tokenListingHasConfirmedSaleTicketSeal: (record) =>
        record.hasSeal === true && record.sealConfirmed === true,
      tokenListingHasPendingSaleTicketSeal: (record) =>
        record.hasSeal === true && record.sealConfirmed !== true,
    },
  );
  assert.equal(statusLabel({ confirmed: false, hasSeal: false }), "Pending listing");
  assert.equal(
    statusLabel({ confirmed: false, hasSeal: true, sealConfirmed: false }),
    "Seal pending",
  );
  assert.equal(
    statusLabel({ confirmed: true, hasSeal: true, sealConfirmed: false }),
    "Seal pending",
  );
  assert.equal(
    statusLabel({ confirmed: true, hasSeal: true, sealConfirmed: true }),
    "Sealed listing",
  );
  assert.equal(statusLabel({ confirmed: true, hasSeal: false }), "Waiting for seal");
});

check("closed listing projections retain seal metadata and close chronology", () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  const closeTxid = "c".repeat(64);
  const tokenClosedListingFromEventPayload = isolatedFunction(
    READER_PATH,
    "tokenClosedListingFromEventPayload",
    {
      dateIso: (value) => new Date(value).toISOString(),
      objectRecord: (value) => value ?? {},
      rowNumber: (value, key) => Number(value?.[key] ?? 0),
      tokenMarketNumbersFromTags: () => ({ amount: 0, priceSats: 0, ticker: "" }),
      tokenRegistryAddressFromPayload: () => "bc1registry",
      validTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
    },
  );
  const closed = tokenClosedListingFromEventPayload({
    closedAt: "2026-06-30T10:49:21.000Z",
    confirmed: true,
    createdAt: "2026-06-21T11:50:32.000Z",
    listingId,
    saleAuthorization: { anchorTxid: listingId },
    sealAt: "2026-06-21T21:18:53.000Z",
    sealConfirmed: true,
    sealTxid,
    tokenId: "work",
    txid: closeTxid,
  });

  assert.equal(closed.createdAt, "2026-06-21T11:50:32.000Z");
  assert.equal(closed.closedAt, "2026-06-30T10:49:21.000Z");
  assert.equal(closed.sealTxid, sealTxid);
  assert.equal(closed.sealConfirmed, true);
  assert.equal(closed.saleAuthorization.anchorTxid, listingId);

  const pendingSeal = tokenClosedListingFromEventPayload({
    closedAt: "2026-07-09T06:27:33.000Z",
    confirmed: false,
    createdAt: "2026-07-09T06:27:33.000Z",
    listingId,
    saleAuthorization: { anchorTxid: listingId },
    sealAt: "2026-07-06T10:09:02.000Z",
    sealConfirmed: false,
    sealTxid,
    tokenId: "work",
    txid: closeTxid,
  });

  assert.equal(pendingSeal.sealTxid, sealTxid);
  assert.equal(pendingSeal.sealConfirmed, false);
});

check("terminal credit listings preserve canonical sale chronology across maintenance rewrites", () => {
  const listingId = "a".repeat(64);
  const closeTxid = "c".repeat(64);
  const listingCreatedAt = "2026-06-21T11:50:32.000Z";
  const canonicalSaleAt = "2026-06-30T10:49:21.000Z";
  const migrationUpdatedAt = "2026-07-16T18:56:08.145Z";
  const dateIso = (value) =>
    value ? new Date(value).toISOString() : undefined;
  const tokenListingFromCreditListingRow = isolatedFunction(
    READER_PATH,
    "tokenListingFromCreditListingRow",
    {
      dateIso,
      normalizeTokenHistoryListingItem: (item) => item,
      objectRecord: (value) => value ?? {},
      rowNumber: (value, key) => Number(value?.[key] ?? 0),
      tokenListingEffectiveCloseTxid: (row) =>
        String(row?.close_txid ?? ""),
      tokenListingEffectiveSaleTicketTxid: (_row, _payload, _authorization, id) =>
        id,
      tokenListingSealConfirmedFromTransaction: () => true,
      validTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
    },
  );
  const sold = tokenListingFromCreditListingRow(
    {
      close_event_time: canonicalSaleAt,
      close_txid: closeTxid,
      listing_id: listingId,
      payload: {
        createdAt: listingCreatedAt,
        saleAuthorization: {},
      },
      status: "sold",
      token_id: "fixture-token",
      updated_at: migrationUpdatedAt,
    },
    "livenet",
  );
  assert.equal(sold.closedAt, canonicalSaleAt);
  assert.equal(sold.createdAt, listingCreatedAt);
  assert.notEqual(sold.closedAt, migrationUpdatedAt);

  const transactionTimed = tokenListingFromCreditListingRow(
    {
      close_transaction_block_time: canonicalSaleAt,
      close_txid: closeTxid,
      listing_id: listingId,
      payload: { saleAuthorization: {} },
      status: "sold",
      token_id: "fixture-token",
      updated_at: migrationUpdatedAt,
    },
    "livenet",
  );
  assert.equal(transactionTimed.closedAt, canonicalSaleAt);
  assert.equal(transactionTimed.createdAt, undefined);

  const active = tokenListingFromCreditListingRow(
    {
      listing_id: listingId,
      payload: { saleAuthorization: {} },
      seal_txid: "b".repeat(64),
      status: "sealing",
      token_id: "fixture-token",
      updated_at: migrationUpdatedAt,
    },
    "livenet",
  );
  assert.equal(active.createdAt, migrationUpdatedAt);
  assert.equal(active.sealAt, migrationUpdatedAt);

  const mergeCanonicalTokenSaleRecord = isolatedFunction(
    READER_PATH,
    "mergeCanonicalTokenSaleRecord",
  );
  const mergeCanonicalTokenClosedListingRecord = isolatedFunction(
    READER_PATH,
    "mergeCanonicalTokenClosedListingRecord",
    {
      mergeTokenListingRecord: (current, incoming) => ({
        ...current,
        ...incoming,
      }),
    },
  );
  const uniqueTokenItems = isolatedFunction(READER_PATH, "uniqueTokenItems", {
    compareTokenItemsByTime: () => 0,
  });
  const [sale] = uniqueTokenItems(
    [
      {
        createdAt: canonicalSaleAt,
        priceSats: 1_000,
        txid: closeTxid,
      },
      {
        createdAt: migrationUpdatedAt,
        priceSats: 1_000,
        txid: closeTxid,
      },
    ],
    (item) => item.txid,
    mergeCanonicalTokenSaleRecord,
  );
  assert.equal(sale.createdAt, canonicalSaleAt);

  const [closed] = uniqueTokenItems(
    [
      {
        closedAt: canonicalSaleAt,
        closedTxid: closeTxid,
        createdAt: canonicalSaleAt,
        listingId,
      },
      {
        closedAt: migrationUpdatedAt,
        closedTxid: closeTxid,
        createdAt: migrationUpdatedAt,
        listingId,
      },
    ],
    (item) => `${item.listingId}:${item.closedTxid}`,
    mergeCanonicalTokenClosedListingRecord,
  );
  assert.equal(closed.closedAt, canonicalSaleAt);
  assert.equal(closed.createdAt, canonicalSaleAt);

  const listingRead = topLevelFunctionSource(
    READER_PATH,
    "proofIndexTokenListingsFromTables",
  );
  assert.match(listingRead, /LEFT JOIN LATERAL[\s\S]*close_event_row\.event_time/u);
  assert.match(listingRead, /close_tx\.status = 'confirmed'/u);
});

check("seal-close summary recovery requires a proven unspent anchor", async () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  let outspend = { spent: true, status: { confirmed: true }, txid: sealTxid };
  const workTokenListingFromCreditListingItem = isolatedFunction(
    API_PATH,
    "workTokenListingFromCreditListingItem",
    {
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: "bc1registry",
      WORK_TOKEN_ID: "work-token",
      WORK_TOKEN_TICKER: "WORK",
      errorSummary: (error) => error?.message ?? String(error),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      tokenListingAnchorOutspend: async () => outspend,
      tokenListingWithoutCloseMetadata: (listing) => {
        const {
          closeTxid,
          closedAt,
          closedConfirmed,
          closedTxid,
          closedVin,
          ...active
        } = listing;
        return active;
      },
      tokenSaleAuthorizationUsesSaleTicketAnchor: () => true,
      tokenSaleAuthorizationUsesSpendableSaleTicketAnchor: () => true,
    },
  );
  const projectedClose = {
    amount: 1_000,
    closeTxid: sealTxid,
    closedConfirmed: true,
    confirmed: true,
    listingId,
    saleAuthorization: {
      anchorType: "sale-ticket-v1",
      anchorVout: 2,
      tokenId: "work-token",
    },
    sealConfirmed: true,
    sealTxid,
    status: "delisted",
    tokenId: "work-token",
  };
  assert.equal(
    await workTokenListingFromCreditListingItem(
      projectedClose,
      "livenet",
      "2026-07-11T00:00:00.000Z",
    ),
    null,
  );

  outspend = { spent: false };
  const recovered = await workTokenListingFromCreditListingItem(
    projectedClose,
    "livenet",
    "2026-07-11T00:00:00.000Z",
  );
  assert.equal(recovered.status, "sealing");
  assert.equal(recovered.closeTxid, undefined);
  assert.equal(recovered.closedTxid, undefined);

  outspend = null;
  assert.equal(
    await workTokenListingFromCreditListingItem(
      projectedClose,
      "livenet",
      "2026-07-11T00:00:00.000Z",
    ),
    null,
  );
});

check("canonical listing actions use their action time", () => {
  const itemTime = isolatedFunction(BACKFILL_PATH, "itemTime");
  assert.equal(
    itemTime({
      createdAt: "2026-05-20T00:00:00.000Z",
      kind: "token-listing-sealed",
      sealAt: "2026-05-23T00:00:00.000Z",
    }),
    "2026-05-23T00:00:00.000Z",
  );
  assert.equal(
    itemTime({
      closedAt: "2026-05-24T00:00:00.000Z",
      createdAt: "2026-05-20T00:00:00.000Z",
      kind: "token-listing-closed",
    }),
    "2026-05-24T00:00:00.000Z",
  );
});

check("canonical raw transaction time survives event projection upserts", async () => {
  let sql = "";
  const upsertTransaction = isolatedFunction(
    BACKFILL_PATH,
    "upsertTransaction",
    {
      NETWORK: "livenet",
      itemTime: () => "2026-05-20T00:00:00.000Z",
      numberOrNull: (value) => Number(value),
    },
  );
  await upsertTransaction(
    {
      async query(statement) {
        sql = String(statement);
        return { rows: [] };
      },
    },
    { blockHeight: 950_667 },
    "a".repeat(64),
    "confirmed",
    "token-listing-sealed",
  );
  assert.match(
    sql,
    /raw_tx \? 'canonicalBlockScan'[\s\S]*THEN proof_indexer\.transactions\.block_time/u,
  );
  assert.match(
    sql,
    /raw_tx \? 'canonicalBlockScan'[\s\S]*THEN proof_indexer\.transactions\.source/u,
  );
});

check("health address checks use bounded Electrum balance responses", async () => {
  const calls = [];
  const healthScripthash = "8f52010f55361085b1806ee106632dd610d3a6587284138d06065d584bab8d21";
  let balance = { confirmed: 0, unconfirmed: 0 };
  const addressIndexHealthPayload = isolatedFunction(
    API_PATH,
    "addressIndexHealthPayload",
    {
      ELECTRUM_HOST: "127.0.0.1",
      ELECTRUM_PORT: 50_001,
      ELECTRUM_HEALTH_SCRIPTHASH: healthScripthash,
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      electrumRequest: async (method, params) => {
        calls.push({ method, params });
        return balance;
      },
      interactiveElectrumRequest: async (method, params) => {
        calls.push({ method, params });
        return balance;
      },
      errorSummary: (error) => String(error?.message ?? error),
      firstPartyAddressReadBases: () => [],
      promiseOutcomeWithin: async (promise) => {
        try {
          return {
            error: null,
            ok: true,
            timedOut: false,
            value: await promise,
          };
        } catch (error) {
          return { error, ok: false, timedOut: false, value: null };
        }
      },
      registryAddressForNetwork: () => "bc1registry",
    },
  );

  const healthy = JSON.parse(
    JSON.stringify(await addressIndexHealthPayload()),
  );
  assert.equal(healthy.ok, true);
  assert.equal(healthy.timedOut, false);
  assert.deepEqual(healthy.canary, {
    confirmedSats: 0,
    scripthash: healthScripthash,
    unconfirmedSats: 0,
  });
  assert.deepEqual(calls.map((call) => call.method), [
    "blockchain.scripthash.get_balance",
  ]);
  assert.deepEqual(calls.map((call) => Array.from(call.params)), [
    [healthScripthash],
  ]);

  calls.length = 0;
  balance = { confirmed: null, unconfirmed: 0 };
  const invalid = JSON.parse(
    JSON.stringify(await addressIndexHealthPayload()),
  );
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /invalid balance response/iu);

  balance = { confirmed: "0", unconfirmed: 0 };
  const coerced = JSON.parse(
    JSON.stringify(await addressIndexHealthPayload()),
  );
  assert.equal(coerced.ok, false);
  assert.match(coerced.error, /invalid balance response/iu);
});

check("Electrum health proves the exact sampled Core block header", async () => {
  const calls = [];
  let derivedHash = "a".repeat(64);
  let headerResponse = "00".repeat(80);
  const electrumHealthPayload = isolatedFunction(
    API_PATH,
    "electrumHealthPayload",
    {
      Buffer,
      ELECTRUM_HOST: "127.0.0.1",
      ELECTRUM_PORT: 50_001,
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      bitcoin: {
        crypto: {
          hash256: () => Buffer.from(derivedHash, "hex").reverse(),
        },
      },
      electrumRequest: async (method, params) => {
        calls.push({ method, params });
        return headerResponse;
      },
      interactiveElectrumRequest: async (method, params) => {
        calls.push({ method, params });
        return headerResponse;
      },
      errorSummary: (error) => String(error?.message ?? error),
      promiseOutcomeWithin: async (promise) => {
        try {
          return {
            error: null,
            ok: true,
            timedOut: false,
            value: await promise,
          };
        } catch (error) {
          return { error, ok: false, timedOut: false, value: null };
        }
      },
    },
  );

  const healthy = JSON.parse(
    JSON.stringify(await electrumHealthPayload(957_864, derivedHash)),
  );
  assert.deepEqual(healthy, {
    configured: true,
    error: "",
    headerHash: derivedHash,
    headerHeight: 957_864,
    ok: true,
    timedOut: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { method: "blockchain.block.header", params: [957_864] },
  ]);

  const mismatch = JSON.parse(
    JSON.stringify(await electrumHealthPayload(957_864, "b".repeat(64))),
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.headerHash, derivedHash);
  assert.match(mismatch.error, /does not match Bitcoin Core/iu);

  headerResponse = "00";
  derivedHash = "c".repeat(64);
  const malformed = JSON.parse(
    JSON.stringify(await electrumHealthPayload(957_864, derivedHash)),
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.headerHash, null);
  assert.match(malformed.error, /invalid block header/iu);

  const callCount = calls.length;
  const missingCore = JSON.parse(
    JSON.stringify(await electrumHealthPayload(0, "")),
  );
  assert.equal(missingCore.ok, false);
  assert.match(missingCore.error, /Core tip is unavailable/iu);
  assert.equal(calls.length, callCount);
});

check("health Electrum probes stop after canary failure and share one deadline", async () => {
  const calls = [];
  let now = 1_000;
  const boundedHealthElectrumPayload = isolatedFunction(
    API_PATH,
    "boundedHealthElectrumPayload",
    {
      Date: { now: () => now },
      ELECTRUM_HOST: "127.0.0.1",
      ELECTRUM_PORT: 50_001,
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      electrumHealthPayload: async (...args) => {
        calls.push(args);
        return { configured: true, ok: true };
      },
    },
  );

  const canaryFailure = JSON.parse(
    JSON.stringify(
      await boundedHealthElectrumPayload(
        { ok: false, timedOut: true },
        957_864,
        "a".repeat(64),
        5_750,
      ),
    ),
  );
  assert.equal(canaryFailure.ok, false);
  assert.equal(canaryFailure.timedOut, true);
  assert.match(canaryFailure.error, /canary failed/iu);
  assert.equal(calls.length, 0);

  now = 5_750;
  const expired = JSON.parse(
    JSON.stringify(
      await boundedHealthElectrumPayload(
        { ok: true },
        957_864,
        "a".repeat(64),
        5_750,
      ),
    ),
  );
  assert.equal(expired.ok, false);
  assert.equal(expired.timedOut, true);
  assert.match(expired.error, /budget expired/iu);
  assert.equal(calls.length, 0);

  now = 4_000;
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await boundedHealthElectrumPayload(
          { ok: true },
          957_864,
          "a".repeat(64),
          5_750,
        ),
      ),
    ),
    { configured: true, ok: true },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [957_864, "a".repeat(64), 1_750],
  ]);
});

check("concurrent and adjacent health requests share one dependency sweep", async () => {
  let loads = 0;
  let resolveLoad;
  let now = 1_000;
  const pending = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const healthPayload = isolatedFunction(API_PATH, "healthPayload", {
    Date: { now: () => now },
    HEALTH_CHECK_TIMEOUT_MS: 5_000,
    HEALTH_PAYLOAD_CACHE_TTL_MS: 2_000,
    healthPayloadCache: null,
    loadHealthPayload: () => {
      loads += 1;
      return pending;
    },
    process: { env: {} },
  });

  const first = healthPayload();
  const second = healthPayload();
  assert.equal(loads, 1);
  resolveLoad({ ok: true, sweep: 1 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(await Promise.all([first, second]))),
    [
      { ok: true, sweep: 1 },
      { ok: true, sweep: 1 },
    ],
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(await healthPayload())),
    { ok: true, sweep: 1 },
  );
  assert.equal(loads, 1);

  now = 3_001;
  assert.deepEqual(
    JSON.parse(JSON.stringify(await healthPayload())),
    { ok: true, sweep: 1 },
  );
  assert.equal(loads, 2);
});

check("canonical read gating exempts node primitives only", () => {
  const canonicalPublicReadGateApplies = isolatedFunction(
    API_PATH,
    "canonicalPublicReadGateApplies",
  );
  const txid = "a".repeat(64);
  for (const path of [
    "/api/v1/address/bc1fixture/utxo",
    "/api/v1/address/bc1fixture/txs",
    "/api/v1/address/bc1fixture/txs/mempool",
    `/api/v1/tx/${txid}`,
    `/api/v1/tx/${txid}/hex`,
    `/api/v1/tx/${txid}/status`,
    `/api/v1/tx/${txid}/outspend/0`,
    "/api/v1/block/00000000",
    "/api/v1/broadcast/tx",
    "/api/v1/internal/token-verifier",
    "/api/v1/prices/btc",
  ]) {
    assert.equal(canonicalPublicReadGateApplies(path), false, path);
  }
  for (const path of [
    "/api/v1/address/bc1fixture/mail",
    "/api/v1/registry-history",
    "/api/v1/token-history",
    "/api/v1/ids/inception",
  ]) {
    assert.equal(canonicalPublicReadGateApplies(path), true, path);
  }
});

check("summary catch-up does not brown out current relational reads", async () => {
  const blockHash = "a".repeat(64);
  let summaryIndexedThroughBlock = 99;
  const summarySnapshotCoversCanonicalReadModels = isolatedFunction(
    API_PATH,
    "summarySnapshotCoversCanonicalReadModels",
  );
  const loadCanonicalPublicReadGate = isolatedFunction(
    API_PATH,
    "loadCanonicalPublicReadGate",
    {
      PROOF_INDEX_HEALTH_MAX_AGE_MS: 120_000,
      PROOF_INDEX_REQUIRED: true,
      bitcoinRpc: async () => ({
        ok: true,
        result: { bestblockhash: blockHash, blocks: 100 },
      }),
      proofIndexCanonicalStateMetaPayload: async () => ({
        fault: {},
        rebuild: { active: false, status: "complete" },
      }),
      proofIndexOperationalStatusPayload: async () => ({
        indexedThroughBlock: 100,
        readModels: {
          confirmedEvents: { count: 10, maxBlock: 99 },
          confirmedIds: { count: 1, maxBlock: 90 },
          confirmedTransfers: { count: 1, maxBlock: 95 },
        },
        scan: { blockHash, complete: true, tipHeight: 100 },
        summarySnapshot: {
          blockHash,
          eligible: true,
          indexedThroughBlock: summaryIndexedThroughBlock,
        },
        worker: {
          lastSuccessAt: new Date().toISOString(),
          ok: true,
        },
      }),
      summarySnapshotCoversCanonicalReadModels,
    },
  );
  const gate = await loadCanonicalPublicReadGate("livenet");
  assert.equal(gate.ok, true);
  assert.equal(gate.summarySnapshotOk, false);
  summaryIndexedThroughBlock = 100;
  const changedGate = await loadCanonicalPublicReadGate("livenet");
  assert.equal(changedGate.summarySnapshotOk, true);

  const summaryGate = isolatedFunction(
    API_PATH,
    "canonicalSummarySnapshotReadGateApplies",
  );
  assert.equal(summaryGate("/api/v1/ids/inception"), false);
  assert.equal(summaryGate("/api/v1/token-history"), false);
  assert.equal(summaryGate("/api/v1/work-floor"), true);
  assert.equal(summaryGate("/api/v1/work-summary"), true);
  assert.equal(summaryGate("/api/v1/marketplace-summary"), true);
  assert.equal(summaryGate("/api/v1/infinity-summary"), true);
  assert.equal(summaryGate("/api/v1/growth-summary"), true);
});

check("long worker cycles do not brown out exact canonical reads", async () => {
  const blockHash = "b".repeat(64);
  const summarySnapshotCoversCanonicalReadModels = isolatedFunction(
    API_PATH,
    "summarySnapshotCoversCanonicalReadModels",
  );
  const loadCanonicalPublicReadGate = isolatedFunction(
    API_PATH,
    "loadCanonicalPublicReadGate",
    {
      PROOF_INDEX_HEALTH_MAX_AGE_MS: 120_000,
      PROOF_INDEX_REQUIRED: true,
      bitcoinRpc: async () => ({
        ok: true,
        result: { bestblockhash: blockHash, blocks: 100 },
      }),
      proofIndexCanonicalStateMetaPayload: async () => ({
        fault: {},
        rebuild: { active: false, status: "complete" },
      }),
      proofIndexOperationalStatusPayload: async () => ({
        indexedThroughBlock: 100,
        readModels: {
          confirmedEvents: { count: 10, maxBlock: 100 },
          confirmedIds: { count: 1, maxBlock: 90 },
          confirmedTransfers: { count: 1, maxBlock: 95 },
        },
        scan: { blockHash, complete: true, tipHeight: 100 },
        summarySnapshot: {
          blockHash,
          eligible: true,
          indexedThroughBlock: 99,
        },
        worker: {
          lastSuccessAt: new Date(Date.now() - 300_000).toISOString(),
          ok: false,
        },
      }),
      summarySnapshotCoversCanonicalReadModels,
    },
  );

  const gate = await loadCanonicalPublicReadGate("livenet");
  assert.equal(gate.ok, true);
  assert.equal(gate.workerFresh, false);
  assert.equal(gate.workerOk, false);
  assert.equal(gate.summarySnapshotOk, false);
});

check("canonical public-read gates cache each network independently", async () => {
  const loads = [];
  const canonicalPublicReadGate = isolatedFunction(
    API_PATH,
    "canonicalPublicReadGate",
    {
      CANONICAL_PUBLIC_READ_GATE_TTL_MS: 2_000,
      CANONICAL_PUBLIC_READ_GATE_TIMEOUT_MS: 15_000,
      CANONICAL_PUBLIC_READ_GATE_TIMEOUT_TTL_MS: 2_000,
      canonicalPublicReadGateCache: new Map(),
      errorSummary: (error) => String(error?.message ?? error),
      loadCanonicalPublicReadGate: async (network) => {
        loads.push(network);
        return { network, ok: true };
      },
      promiseOutcomeWithin: async (promise) => ({
        ok: true,
        timedOut: false,
        value: await promise,
      }),
    },
  );
  await canonicalPublicReadGate("livenet");
  await canonicalPublicReadGate("testnet");
  await canonicalPublicReadGate("livenet");
  assert.deepEqual(loads, ["livenet", "testnet"]);
});

check("exact current ID reads preserve the confirmed database record", () => {
  assert.match(
    fileSource(READER_PATH),
    /function confirmedIdRecordFromRow[\s\S]*?amountSats:\s*ID_REGISTRATION_PRICE_SATS/u,
    "relational ID records must retain their canonical registration proof amount",
  );
  const exactIdRecordsWithIndexedConfirmation = isolatedFunction(
    API_PATH,
    "exactIdRecordsWithIndexedConfirmation",
    {
      normalizePowId: (value) => String(value).trim().toLowerCase(),
    },
  );
  const confirmed = {
    confirmed: true,
    id: "inception",
    ownerAddress: "bc1currentowner",
    txid: "c".repeat(64),
  };
  const records = exactIdRecordsWithIndexedConfirmation(
    { records: [] },
    { records: [confirmed] },
    "inception",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].confirmed, true);
  assert.equal(records[0].ownerAddress, "bc1currentowner");
});

check("exact ID lifecycle keeps sealed listings active until a canonical close", () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  const delistTxid = "c".repeat(64);
  const buyTxid = "d".repeat(64);
  const siblingListingId = "9".repeat(64);
  const sellerAddress = "bc1seller";
  const buyerAddress = "bc1buyer";
  const idLifecycleStateFromItems = isolatedFunction(
    READER_PATH,
    "idLifecycleStateFromItems",
    {
      compareHistoryItems: (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
      dateIso: (value) => new Date(value).toISOString(),
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      normalizedText: (value) => String(value ?? "").trim(),
      normalizedTxid: (value) => {
        const txid = String(value ?? "").trim().toLowerCase();
        return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
      },
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {},
    },
  );
  const authorization = {
    anchorSignature: "",
    anchorTxid: "",
    anchorType: "sale-ticket-v1",
    anchorValueSats: 546,
    anchorVout: 2,
    id: "fixture-id",
    nonce: "fixture",
    priceSats: 12_345,
    sellerAddress,
    version: "pwid-sale-v4",
  };
  const list = {
    blockHeight: 100,
    blockIndex: 1,
    _powEventIndex: 0,
    confirmed: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    id: "fixture-id",
    kind: "id-list",
    listingId,
    listingVersion: "list5",
    priceSats: 12_345,
    saleAuthorization: authorization,
    sellerAddress,
    txid: listingId,
  };
  const seal = {
    blockHeight: 100,
    blockIndex: 1,
    _powEventIndex: 1,
    confirmed: true,
    createdAt: "2026-07-11T00:10:00.000Z",
    kind: "id-seal",
    listingId,
    saleAuthorization: {
      ...authorization,
      anchorSignature: "3044fixture",
      anchorTxid: listingId,
    },
    txid: sealTxid,
  };

  const sealed = idLifecycleStateFromItems(
    [list, seal],
    "livenet",
    "fixture-id",
  );
  assert.equal(sealed.listings.length, 1);
  assert.equal(sealed.listings[0].listingId, listingId);
  assert.equal(sealed.listings[0].txid, listingId);
  assert.equal(sealed.listings[0].sealTxid, sealTxid);
  assert.equal(sealed.listings[0].saleAuthorization.anchorTxid, listingId);
  assert.equal(
    sealed.listings[0].saleAuthorization.anchorSignature,
    "3044fixture",
  );
  assert.equal(sealed.activity[0].kind, "id-seal");

  for (const [version, listingVersion] of [
    ["pwid-sale-v2", "list3"],
    ["pwid-sale-v3", "list4"],
  ]) {
    const legacyListingId = listingVersion === "list3" ? "7".repeat(64) : "8".repeat(64);
    const legacy = idLifecycleStateFromItems(
      [
        {
          ...list,
          listingId: legacyListingId,
          listingVersion: undefined,
          saleAuthorization: { ...authorization, version },
          txid: legacyListingId,
        },
      ],
      "livenet",
      "fixture-id",
    );
    assert.equal(legacy.listings[0].listingVersion, listingVersion);
  }

  const delisted = idLifecycleStateFromItems(
    [
      list,
      seal,
      {
        blockHeight: 102,
        blockIndex: 1,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        kind: "id-delist",
        listingId,
        txid: delistTxid,
      },
    ],
    "livenet",
    "fixture-id",
  );
  assert.equal(delisted.listings.length, 0);
  assert.equal(delisted.sales.length, 0);

  const bought = idLifecycleStateFromItems(
    [
      list,
      seal,
      {
        ...list,
        blockHeight: 101,
        blockIndex: 3,
        createdAt: "2026-07-11T00:15:00.000Z",
        listingId: siblingListingId,
        txid: siblingListingId,
      },
      {
        amountSats: 546,
        blockHeight: 102,
        blockIndex: 1,
        buyerAddress,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "fixture-id",
        kind: "id-buy",
        listingId,
        ownerAddress: buyerAddress,
        priceSats: 12_345,
        receiveAddress: buyerAddress,
        sellerAddress,
        transferVersion: "buy5",
        txid: buyTxid,
      },
    ],
    "livenet",
    "fixture-id",
  );
  assert.equal(bought.listings.length, 0);
  assert.equal(bought.sales.length, 1);
  assert.equal(bought.sales[0].listingId, listingId);
  assert.equal(bought.sales[0].buyerAddress, buyerAddress);
  assert.equal(bought.sales[0].priceSats, 12_345);

  const legacyBuy = idLifecycleStateFromItems(
    [
      list,
      {
        amountSats: 546,
        blockHeight: 102,
        blockIndex: 1,
        buyerAddress,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "fixture-id",
        kind: "id-buy",
        listingId,
        ownerAddress: buyerAddress,
        priceSats: 12_345,
        receiveAddress: buyerAddress,
        sellerAddress,
        transferVersion: "buy2",
        txid: "4".repeat(64),
      },
    ],
    "livenet",
    "fixture-id",
  );
  assert.equal(legacyBuy.listings.length, 0);
  assert.equal(legacyBuy.sales.length, 0);
  assert.equal(legacyBuy.activity[0].kind, "id-buy");

  const otherListingId = "6".repeat(64);
  const broad = idLifecycleStateFromItems(
    [
      list,
      seal,
      {
        ...list,
        blockHeight: 101,
        id: "other-id",
        listingId: otherListingId,
        saleAuthorization: { ...authorization, id: "other-id" },
        txid: otherListingId,
      },
      {
        amountSats: 546,
        blockHeight: 102,
        blockIndex: 1,
        buyerAddress,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "fixture-id",
        kind: "id-buy",
        listingId,
        ownerAddress: buyerAddress,
        priceSats: 12_345,
        receiveAddress: buyerAddress,
        sellerAddress,
        transferVersion: "buy5",
        txid: buyTxid,
      },
    ],
    "livenet",
    "",
  );
  assert.deepEqual(
    Array.from(broad.listings, (item) => item.listingId),
    [otherListingId],
  );
  assert.equal(broad.sales.length, 1);
  assert.equal(broad.sales[0].id, "fixture-id");

  const transferred = idLifecycleStateFromItems(
    [
      list,
      {
        ...list,
        blockHeight: 101,
        id: "other-id",
        listingId: otherListingId,
        saleAuthorization: { ...authorization, id: "other-id" },
        txid: otherListingId,
      },
      {
        blockHeight: 102,
        blockIndex: 1,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "other-id",
        kind: "id-transfer",
        ownerAddress: "bc1newowner",
        receiveAddress: "bc1newowner",
        txid: "5".repeat(64),
      },
    ],
    "livenet",
    "",
  );
  assert.deepEqual(
    Array.from(transferred.listings, (item) => item.listingId),
    [listingId],
  );
});

check("exact ID API lifecycle feeds every ID marketplace preflight", async () => {
  const listing = {
    confirmed: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    id: "fixture-id",
    listingId: "e".repeat(64),
    network: "livenet",
    saleAuthorization: {},
    sellerAddress: "bc1seller",
    txid: "e".repeat(64),
  };
  const sale = {
    buyerAddress: "bc1buyer",
    confirmed: true,
    createdAt: "2026-07-11T00:10:00.000Z",
    id: "fixture-id",
    network: "livenet",
    sellerAddress: "bc1seller",
    transferVersion: "buy5",
    txid: "f".repeat(64),
  };
  const proofIndexIdRecordPayload = isolatedFunction(
    READER_PATH,
    "proofIndexIdRecordPayload",
    {
      confirmedIdLifecycleFromCurrentEvents: async () => ({
        activity: [{ ...listing, kind: "id-list" }],
        listings: [listing],
        sales: [sale],
      }),
      confirmedIdRecordsFromCurrentTables: async () => [
        {
          confirmed: true,
          createdAt: "2026-07-11T00:00:00.000Z",
          id: "fixture-id",
          network: "livenet",
          ownerAddress: "bc1seller",
          receiveAddress: "bc1seller",
          txid: "1".repeat(64),
          updatedHeight: 101,
        },
      ],
      indexedThroughBlockFromItems: () => 101,
      newestDateIso: () => "2026-07-11T00:10:00.000Z",
      proofIndexPool: () => ({}),
    },
  );
  const payload = await proofIndexIdRecordPayload("livenet", "fixture-id");
  assert.equal(payload.listings[0].listingId, listing.listingId);
  assert.equal(payload.sales[0].txid, sale.txid);
  assert.equal(payload.source, "proof-indexer-id-record-lifecycle");

  const appSource = fileSource(APP_PATH);
  const replacementDefinition = topLevelFunctionSource(
    APP_PATH,
    "replaceExactPowIdStateItems",
  );
  const replacementBodyStart = replacementDefinition.indexOf(
    "{",
    replacementDefinition.indexOf(")"),
  );
  assert.ok(replacementBodyStart > 0, "exact ID replacement body missing");
  const replacementContext = vm.createContext({
    normalizePowId: (value) => String(value ?? "").trim().toLowerCase(),
  });
  new vm.Script(
    `function replaceExactPowIdStateItems(current, incoming, id, network) ${replacementDefinition
      .slice(replacementBodyStart)
      .replace(/\(item:\s*T\)/gu, "(item)")}\nthis.__replaceExactPowIdStateItems = replaceExactPowIdStateItems;`,
    { filename: APP_PATH.pathname },
  ).runInContext(replacementContext);
  const replaceExactPowIdStateItems =
    replacementContext.__replaceExactPowIdStateItems;
  const staleExact = {
    id: "fixture-id",
    listingId: "2".repeat(64),
    network: "livenet",
  };
  const unrelated = {
    id: "other-id",
    listingId: "3".repeat(64),
    network: "livenet",
  };
  const otherNetwork = {
    id: "fixture-id",
    listingId: "4".repeat(64),
    network: "testnet4",
  };
  const cleared = replaceExactPowIdStateItems(
    [staleExact, unrelated, otherNetwork],
    [],
    "fixture-id",
    "livenet",
  );
  assert.deepEqual(
    Array.from(cleared, (item) => item.listingId),
    [unrelated.listingId, otherNetwork.listingId],
  );
  const replacement = {
    id: "fixture-id",
    listingId: "5".repeat(64),
    network: "livenet",
  };
  const replaced = replaceExactPowIdStateItems(
    [staleExact, unrelated],
    [replacement],
    "fixture-id",
    "livenet",
  );
  assert.deepEqual(
    Array.from(replaced, (item) => item.listingId),
    [replacement.listingId, unrelated.listingId],
  );

  const section = (start, end) => {
    const startIndex = appSource.indexOf(start);
    const endIndex = appSource.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} section missing`);
    return appSource.slice(startIndex, endIndex);
  };
  const exactFetcher = section(
    "async function fetchIdRecordState(",
    "async function fetchGlobalActivity(",
  );
  assert.match(exactFetcher, /current:\s*"1"/u);
  assert.match(exactFetcher, /fresh:\s*"1"/u);
  for (const actionSource of [
    section("async function sealIdListing(", "async function delistIdListing("),
    section("async function delistIdListing(", "async function purchaseId("),
    section("async function purchaseId(", "async function updateIdReceiver("),
  ]) {
    assert.match(actionSource, /fetchIdRecordState\(network,/u);
    assert.match(actionSource, /replaceExactPowIdStateItems\(/u);
    assert.match(actionSource, /latestState\.pendingEvents/u);
    assert.match(actionSource, /latestState\.sales/u);
    assert.match(actionSource, /latestState\.listings\.find\(/u);
  }
});

check("unpinned broad ID registry uses current relational event state", async () => {
  const listing = {
    confirmed: true,
    createdAt: "2026-07-11T00:10:00.000Z",
    id: "listed-id",
    listingId: "a".repeat(64),
    network: "livenet",
    priceSats: 12_345,
    sellerAddress: "bc1seller",
    txid: "a".repeat(64),
  };
  const confirmedSale = {
    buyerAddress: "bc1buyer",
    confirmed: true,
    createdAt: "2026-07-11T00:08:00.000Z",
    id: "sold-id",
    network: "livenet",
    priceSats: 20_000,
    sellerAddress: "bc1seller",
    transferVersion: "buy5",
    txid: "b".repeat(64),
  };
  const pendingSale = {
    buyerAddress: "bc1pendingbuyer",
    confirmed: false,
    createdAt: "2026-07-11T00:12:00.000Z",
    id: "pending-sale-id",
    network: "livenet",
    priceSats: 30_000,
    sellerAddress: "bc1seller",
    transferVersion: "buy5",
    txid: "c".repeat(64),
  };
  const confirmedRecord = {
    confirmed: true,
    createdAt: "2026-07-10T00:00:00.000Z",
    id: "listed-id",
    network: "livenet",
    ownerAddress: "bc1seller",
    receiveAddress: "bc1seller",
    txid: "d".repeat(64),
    updatedHeight: 100,
  };
  const pendingRecord = {
    confirmed: false,
    createdAt: "2026-07-11T00:11:00.000Z",
    id: "pending-id",
    network: "livenet",
    ownerAddress: "bc1pending",
    receiveAddress: "bc1pending",
    txid: "e".repeat(64),
  };
  const pendingEvent = {
    confirmed: false,
    createdAt: "2026-07-11T00:12:00.000Z",
    id: "pending-sale-id",
    kind: "marketTransfer",
    network: "livenet",
    txid: pendingSale.txid,
  };
  const confirmedRegistration = {
    confirmed: true,
    createdAt: confirmedRecord.createdAt,
    id: confirmedRecord.id,
    kind: "id-register",
    network: "livenet",
    txid: confirmedRecord.txid,
  };
  let registryActivity = [confirmedRegistration, pendingEvent, listing];
  let scanComplete = true;
  let scanHeight = 101;
  let scanHash = "f".repeat(64);
  const currentProofIndexRegistryPayload = isolatedFunction(
    READER_PATH,
    "currentProofIndexRegistryPayload",
    {
      compareHistoryItems: (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
      confirmedIdRecordsFromCurrentTables: async () => [confirmedRecord],
      currentIdRegistryEventState: async () => ({
        activity: registryActivity,
        listings: [listing],
        pendingEvents: [pendingEvent],
        pendingRecords: [pendingRecord],
        pendingSales: [pendingSale],
        sales: [confirmedSale],
      }),
      dateIso: (value) => new Date(value).toISOString(),
      indexedThroughBlockFromItems: () => 100,
      latestProofIndexScanMetadata: async () => ({
        generated_at: "2026-07-11T00:13:00.000Z",
        indexed_through_block: scanHeight,
        payload: {
          complete: scanComplete,
          indexedThroughBlockHash: scanHash,
        },
        snapshot_id: "current-scan",
      }),
      newestDateIso: (values) =>
        new Date(Math.max(...values.map((value) => Date.parse(value)))).toISOString(),
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      objectRecord: (value) => value ?? {},
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
      salesStats: (sales) => ({
        confirmedSales: sales.filter((sale) => sale.confirmed).length,
        confirmedSalesVolumeSats: sales
          .filter((sale) => sale.confirmed)
          .reduce((sum, sale) => sum + sale.priceSats, 0),
        pendingSales: sales.filter((sale) => !sale.confirmed).length,
        pendingSalesVolumeSats: sales
          .filter((sale) => !sale.confirmed)
          .reduce((sum, sale) => sum + sale.priceSats, 0),
        sales: sales.length,
        salesVolumeSats: sales.reduce((sum, sale) => sum + sale.priceSats, 0),
      }),
      uniqueTxidCount: (items) => new Set(items.map((item) => item.txid)).size,
    },
  );
  const current = await currentProofIndexRegistryPayload(
    {},
    "livenet",
    { registryAddress: "bc1registry" },
  );
  assert.deepEqual(
    Array.from(current.records, (record) => record.id),
    ["listed-id", "pending-id"],
  );
  assert.equal(current.listings[0].listingId, listing.listingId);
  assert.equal(current.sales.length, 2);
  assert.equal(current.stats.confirmedSalesVolumeSats, 20_000);
  assert.equal(current.stats.pendingSalesVolumeSats, 30_000);
  assert.equal(current.stats.pendingRecords, 1);
  assert.equal(current.stats.pendingChanges, 1);
  assert.equal(current.indexedThroughBlock, 101);
  assert.equal(current.indexedThroughBlockHash, "f".repeat(64));
  assert.equal(current.snapshotId, "current-scan");
  assert.equal(
    current.source,
    "proof-indexer-current-id-events+proof-indexer-confirmed-id-records",
  );
  scanComplete = false;
  assert.equal(
    await currentProofIndexRegistryPayload({}, "livenet", {
      registryAddress: "bc1registry",
    }),
    null,
    "ordinary reads must reject an incomplete scan",
  );
  assert.equal(
    (
      await currentProofIndexRegistryPayload({}, "livenet", {
        allowIncompleteScan: true,
        expectedHash: scanHash,
        expectedHeight: scanHeight,
        registryAddress: "bc1registry",
      })
    )?.indexedThroughBlockHash,
    scanHash,
    "an incomplete scan is readable only at its exact checkpoint",
  );
  assert.equal(
    await currentProofIndexRegistryPayload({}, "livenet", {
      allowIncompleteScan: true,
      expectedHash: "e".repeat(64),
      expectedHeight: scanHeight,
      registryAddress: "bc1registry",
    }),
    null,
  );
  assert.equal(
    await currentProofIndexRegistryPayload({}, "livenet", {
      allowIncompleteScan: true,
      expectedHash: scanHash,
      expectedHeight: scanHeight - 1,
      registryAddress: "bc1registry",
    }),
    null,
  );
  assert.equal(
    await currentProofIndexRegistryPayload({}, "livenet", {
      allowIncompleteScan: true,
      expectedHeight: scanHeight,
      registryAddress: "bc1registry",
    }),
    null,
    "one-sided checkpoint options must fail closed",
  );
  scanComplete = true;
  registryActivity = [
    ...registryActivity,
    {
      confirmed: true,
      id: "missing-relational-record",
      kind: "id-register",
    },
  ];
  assert.equal(
    await currentProofIndexRegistryPayload({}, "livenet", {
      registryAddress: "bc1registry",
    }),
    null,
  );

  let currentReads = 0;
  let snapshotReads = 0;
  const proofIndexRegistryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexRegistryPayload",
    {
      currentProofIndexRegistryPayload: async () => {
        currentReads += 1;
        return current;
      },
      ledgerSnapshotWithPayload: async () => {
        snapshotReads += 1;
        return null;
      },
      normalizedSnapshotId: (value) => {
        const snapshotId = String(value ?? "").trim();
        return !snapshotId || snapshotId.length > 128 || /\s/u.test(snapshotId)
          ? ""
          : snapshotId;
      },
      proofIndexPool: () => ({}),
    },
  );
  assert.equal(
    await proofIndexRegistryPayload("livenet", {}),
    current,
  );
  assert.equal(currentReads, 1);
  assert.equal(snapshotReads, 0);
  assert.equal(
    await proofIndexRegistryPayload("livenet", { snapshotId: "pinned" }),
    null,
  );
  assert.equal(snapshotReads, 1);
  assert.equal(
    await proofIndexRegistryPayload("livenet", { snapshotId: "invalid pin" }),
    null,
  );
  assert.equal(currentReads, 1);
  assert.equal(snapshotReads, 1);
});

check("token verifier uses event-specific seal and close confirmation", () => {
  const sealTxid = "d".repeat(64);
  const closeTxid = "e".repeat(64);
  const tokenVerifierItemsFromState = isolatedFunction(
    API_PATH,
    "tokenVerifierItemsFromState",
  );
  const state = {
    closedListings: [
      {
        closedConfirmed: false,
        closedTxid: closeTxid,
        confirmed: true,
        listingId: "f".repeat(64),
        sealConfirmed: false,
        sealTxid,
      },
    ],
  };
  const [seal] = tokenVerifierItemsFromState(state, sealTxid);
  const [close] = tokenVerifierItemsFromState(state, closeTxid);
  assert.equal(seal.kind, "token-listing-sealed");
  assert.equal(seal.confirmed, false);
  assert.equal(close.kind, "token-listing-closed");
  assert.equal(close.confirmed, false);

  state.closedListings[0].sealConfirmed = true;
  state.closedListings[0].closedConfirmed = true;
  assert.equal(tokenVerifierItemsFromState(state, sealTxid)[0].confirmed, true);
  assert.equal(tokenVerifierItemsFromState(state, closeTxid)[0].confirmed, true);
});

check("operational status preserves compact canonical health coverage", async () => {
  let row = {
    confirmed_event_count: 23_914,
    confirmed_event_max_block: 123,
    confirmed_id_count: 493,
    confirmed_id_max_block: 118,
    confirmed_transfer_count: 87,
    confirmed_transfer_max_block: 121,
    generated_at: "2026-07-13T14:30:31.811Z",
    indexed_through_block: 123,
    scan_block_hash: "a".repeat(64),
    scan_consistency_complete: false,
    scan_metrics_complete: true,
    scan_metrics_stop_reason: "reached-tip",
    scan_metrics_tip_height: 123,
    scan_payload_complete: false,
    scan_payload_stop_reason: null,
    scan_payload_tip_height: 0,
    snapshot_id: "scan-snapshot",
    summary_coverage: {
      growthSummary: {
        nested: [119, 118, null],
        parent: [121, 120, null],
      },
      inceptionSummary: { parent: [118, null, null] },
      infinitySummary: { parent: [117, null, null] },
      logSummary: { parent: [120, null, null] },
      marketplaceSummary: {
        nested: [116, 115, null],
        parent: [120, 119, null],
      },
      tokenSummary: { parent: [119, null, null] },
      workFloor: { parent: [115, null, null] },
      workSummary: {
        nested: [114, 113, null],
        parent: [122, 121, null],
      },
    },
    summary_generated_at: "2026-07-13T14:29:00.000Z",
    summary_block_hash: "a".repeat(64),
    summary_indexed_at: "2026-07-13T14:29:01.000Z",
    summary_snapshot_id: "summary-snapshot",
    worker: {
      lastSuccessAt: "2026-07-13T14:30:00.000Z",
      ok: true,
      updatedAt: "stale-value",
    },
    worker_updated_at: "2026-07-13T14:30:00.818Z",
  };
  const operationalStatus = isolatedFunction(
    READER_PATH,
    "proofIndexOperationalStatusPayload",
    {
      dateIso: (value) => new Date(value).toISOString(),
      latestProofIndexOperationalMetadata: async () => row,
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {},
      proofIndexPool: () => ({}),
      rowNumber: (value, key) => Number(value?.[key] ?? 0),
      safeBlockHeight: (value) => {
        const height = Number(value);
        return Number.isSafeInteger(height) && height > 0 ? height : 0;
      },
    },
  );

  const status = JSON.parse(
    JSON.stringify(await operationalStatus("livenet")),
  );
  assert.equal(status.indexedAt, "2026-07-13T14:30:31.811Z");
  assert.equal(status.indexedThroughBlock, 123);
  assert.deepEqual(status.readModels, {
    confirmedEvents: { count: 23_914, maxBlock: 123 },
    confirmedIds: { count: 493, maxBlock: 118 },
    confirmedTransfers: { count: 87, maxBlock: 121 },
  });
  assert.deepEqual(status.scan, {
    blockHash: "a".repeat(64),
    complete: true,
    snapshotId: "scan-snapshot",
    stopReason: "reached-tip",
    tipHeight: 123,
  });
  assert.deepEqual(status.summarySnapshot, {
    blockHash: "a".repeat(64),
    coverageByKey: {
      growthSummary: 119,
      inceptionSummary: 118,
      infinitySummary: 117,
      logSummary: 120,
      marketplaceSummary: 116,
      tokenSummary: 119,
      workFloor: 115,
      workSummary: 114,
    },
    eligible: true,
    generatedAt: "2026-07-13T14:29:00.000Z",
    indexedAt: "2026-07-13T14:29:01.000Z",
    indexedThroughBlock: 114,
    snapshotId: "summary-snapshot",
  });
  assert.deepEqual(status.worker, {
    lastSuccessAt: "2026-07-13T14:30:00.000Z",
    ok: true,
    updatedAt: "2026-07-13T14:30:00.818Z",
  });

  row = {
    ...row,
    summary_coverage: {
      ...row.summary_coverage,
      growthSummary: {
        ...row.summary_coverage.growthSummary,
        nested: [],
      },
    },
  };
  const incomplete = JSON.parse(
    JSON.stringify(await operationalStatus("livenet")),
  );
  assert.equal(incomplete.summarySnapshot.coverageByKey.growthSummary, 0);
  assert.equal(incomplete.summarySnapshot.indexedThroughBlock, 0);
  assert.equal(incomplete.summarySnapshot.eligible, false);
});

check("canonical WORK snapshots require exact Q8 markers and preserve only bound legacy text", () => {
  const exactBinding = isolatedExactWorkNetworkValueSummaryBinding();
  const q8 = "900719925474099300000001";
  const summaryPayloads = { workFloor: exactWorkFloorFixture(q8) };
  assert.deepEqual(
    JSON.parse(JSON.stringify(exactBinding(summaryPayloads))),
    {
      workNetworkValueAccountingModel:
        WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      workNetworkValueQ8: q8,
      workNetworkValueSats: "9007199254740993.00000001",
    },
  );

  const withoutFloorMarker = structuredClone(summaryPayloads);
  delete withoutFloorMarker.workFloor.workNetworkValueAccountingModel;
  assert.equal(exactBinding(withoutFloorMarker), null);
  const withoutQ8 = structuredClone(summaryPayloads);
  delete withoutQ8.workFloor.actualValue.totalQ8;
  assert.equal(exactBinding(withoutQ8), null);
  const oneQ8Drift = structuredClone(summaryPayloads);
  oneQ8Drift.workFloor.actualValue.totalQ8 = (BigInt(q8) + 1n).toString();
  assert.equal(exactBinding(oneQ8Drift), null);
  const numericQ8 = structuredClone(summaryPayloads);
  numericQ8.workFloor.networkValueQ8 = Number(q8);
  assert.equal(
    exactBinding(numericQ8),
    null,
    "a current snapshot cannot reconstruct exact Q8 from Number input",
  );

  const canonicalSnapshotQ8Text = isolatedFunction(
    READER_PATH,
    "canonicalSnapshotQ8Text",
    { canonicalIntegerText },
  );
  assert.equal(canonicalSnapshotQ8Text(q8, { positive: true }), q8);
  assert.equal(
    canonicalSnapshotQ8Text(Number(q8), { positive: true }),
    "",
    "the reader must not reconstruct an exact Q8 witness from Number input",
  );

  const canonicalNonNegativeQ8Text = isolatedFunction(
    BACKFILL_PATH,
    "canonicalNonNegativeQ8Text",
  );
  const summarySnapshotTotals = isolatedFunction(
    BACKFILL_PATH,
    "summarySnapshotTotals",
    { exactWorkNetworkValueSummaryBinding: exactBinding },
  );
  const exactSummarySnapshotTotalsCurrent = isolatedFunction(
    BACKFILL_PATH,
    "exactSummarySnapshotTotalsCurrent",
    {
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      canonicalNonNegativeQ8Text,
      exactWorkNetworkValueSummaryBinding: exactBinding,
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
    },
  );
  const totals = summarySnapshotTotals(summaryPayloads);
  assert.deepEqual(
    JSON.parse(JSON.stringify(totals)),
    exactSummaryTotalsFixture(q8),
  );
  assert.equal(
    exactSummarySnapshotTotalsCurrent({ summaryPayloads, totals }),
    true,
  );
  assert.equal(
    exactSummarySnapshotTotalsCurrent({
      summaryPayloads,
      totals: {
        ...totals,
        growthActualValueQ8: (BigInt(q8) + 1n).toString(),
      },
    }),
    false,
  );

  const canonicalIncbValueSnapshotBinding = isolatedFunction(
    BACKFILL_PATH,
    "canonicalIncbValueSnapshotBinding",
    {
      INCB_VALUE_SNAPSHOT_MODEL: "canonical-summary-h-minus-one-v1",
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      canonicalNonNegativeQ8Text,
      incbIssuanceMetadataInvalidReason: () => "",
      q8TextFromDecimal,
    },
  );
  const legacyMintWitness = {
    issuanceValueSnapshotBlockHash: "a".repeat(64),
    issuanceValueSnapshotBlockHeight: 958_382,
    issuanceValueSnapshotCanonicalSummaryHash: "b".repeat(64),
    issuanceValueSnapshotGeneratedAt: "2026-07-18T00:00:00.000Z",
    issuanceValueSnapshotId: "legacy-bound-snapshot",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueSats:
      "9007199254740993.00000001",
  };
  const legacyBinding = canonicalIncbValueSnapshotBinding(
    legacyMintWitness,
  );
  assert.equal(legacyBinding.workNetworkValueQ8, q8);
  assert.equal(
    legacyBinding.workNetworkValueWitnessMode,
    "locked-bound-legacy-work-value-v1",
  );
  assert.throws(
    () =>
      canonicalIncbValueSnapshotBinding({
        ...legacyMintWitness,
        issuanceValueSnapshotWorkNetworkValueSats: Number(
          legacyMintWitness.issuanceValueSnapshotWorkNetworkValueSats,
        ),
      }),
    /no stored exact WORK Q8 witness/u,
  );

  const lockedSnapshotQ8 = isolatedFunction(
    BACKFILL_PATH,
    "lockedCanonicalIncbSnapshotWorkNetworkValueQ8",
    {
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      canonicalNonNegativeQ8Text,
      q8TextFromDecimal,
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(lockedSnapshotQ8({
      work_network_value_sats_type: "string",
      work_network_value_sats_text: "9007199254740993.00000001",
    }))),
    { mode: "locked-bound-legacy-work-value-v1", valueQ8: q8 },
  );
  assert.equal(
    lockedSnapshotQ8({
      work_network_value_sats_type: "number",
      work_network_value_sats_text: Number(
        legacyMintWitness.issuanceValueSnapshotWorkNetworkValueSats,
      ),
    }),
    null,
  );
  const lockedReaderSource = topLevelFunctionSource(
    BACKFILL_PATH,
    "lockedCanonicalIncbValueSnapshots",
  );
  assert.match(lockedReaderSource, /snapshot_id = ANY\(\$2::text\[\]\)/u);
  assert.match(lockedReaderSource, /FOR UPDATE/u);
});

check("canonical consistency reads the exact eligible summary snapshot", async () => {
  const snapshotId = "summary-snapshot";
  const checks = [
    {
      name: "token-components-cover-confirmed-activity",
      ok: true,
    },
    {
      name: "canonical-activity-count-matches-public-log",
      ok: true,
    },
  ];
  let queryText = "";
  const safeBlockHeight = (value) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0
      ? Number(value)
      : 0;
  const canonicalSnapshotQ8Text = isolatedFunction(
    READER_PATH,
    "canonicalSnapshotQ8Text",
    { canonicalIntegerText },
  );
  const canonicalSummaryLedgerRowBinding = isolatedFunction(
    READER_PATH,
    "canonicalSummaryLedgerRowBinding",
    {
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      canonicalSnapshotQ8Text,
      decimalTextFromQ8,
      safeBlockHeight,
    },
  );
  const canonicalSummaryLedgerValueBindingsAgree = isolatedFunction(
    READER_PATH,
    "canonicalSummaryLedgerValueBindingsAgree",
  );
  const readCanonicalSummary = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalSummaryLedgerPayload",
    {
      canonicalSummaryLedgerRowBinding,
      canonicalSummaryLedgerValueBindingsAgree,
      dateIso: (value) => new Date(value).toISOString(),
      proofIndexPool: () => ({
        async query(sql, params) {
          queryText = String(sql);
          assert.deepEqual(Array.from(params), [
            "livenet",
            WORK_ATOMIC_PROJECTION_MODEL,
          ]);
          return {
            rows: [
              {
                consistency: {
                  checks,
                  missingLogEvents: [],
                  ok: true,
                  status: "green",
                },
                generated_at: "2026-07-12T14:16:59.808Z",
                growth_floor_height: 957712,
                growth_height: 957712,
                growth_snapshot_id: snapshotId,
                indexed_through_block: 957712,
                inception_height: 957712,
                inception_snapshot_id: snapshotId,
                infinity_height: 957712,
                infinity_snapshot_id: snapshotId,
                log_height: 957712,
                log_snapshot_id: snapshotId,
                marketplace_floor_height: 957712,
                marketplace_height: 957712,
                marketplace_snapshot_id: snapshotId,
                metrics: {
                  activityItems: 23591,
                  confirmedComputerActions: 23585,
                  indexedThroughBlock: 957712,
                },
                payload_snapshot_id: snapshotId,
                payload_indexed_through_block_hash: "a".repeat(64),
                summary_refresh_block_hash: "a".repeat(64),
                summary_refresh_mode: "canonical-summary-refresh",
                snapshot_id: snapshotId,
                source_hashes: {
                  activity: { confirmed: 23585, count: 23591 },
                  blockScan: "a".repeat(64),
                  canonicalSummary: "b".repeat(64),
                },
                token_height: 957712,
                token_snapshot_id: snapshotId,
                ...exactCanonicalSummaryRowValueFixture(
                  "817166309400000000",
                ),
                work_floor_height: 957712,
                work_floor_block_hash: "a".repeat(64),
                work_floor_snapshot_id: snapshotId,
                work_summary_floor_height: 957712,
                work_summary_height: 957712,
                work_summary_snapshot_id: snapshotId,
              },
            ],
          };
        },
      }),
      safeBlockHeight,
    },
  );
  const result = await readCanonicalSummary("livenet");
  assert.match(
    queryText,
    /canonical-activity-count-matches-public-log/u,
  );
  assert.match(queryText, /1::bigint AS matching_snapshot_count/u);
  assert.match(
    queryText,
    /payload->>'workAmountStorageModel' = \$2/u,
  );
  assert.match(queryText, /LIMIT 1/u);
  assert.doesNotMatch(queryText, /count\(\*\) OVER \(\)/u);
  assert.equal(result.snapshotId, snapshotId);
  assert.equal(result.metrics.activityItems, 23591);
  assert.equal(result.metrics.confirmedComputerActions, 23585);
  assert.equal(result.consistency.checks.length, 2);
  assert.equal(result.workFloor.networkValueSats, "8171663094");
});

check("Inception H-1 oracle accepts agreeing versioned exact green summaries", async () => {
  const oldSnapshotId = "b8e77cd30cbed6855977c514";
  const newestSnapshotId = "f5c90f056a79e3a84211d5c7";
  const height = 957_949;
  const blockHash =
    "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e";
  const oldCanonicalSummaryHash =
    "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc";
  const newestCanonicalSummaryHash =
    "7a388fc63d694c493b95a8699f526e3f32bb338be3be22d2e02a973a616d3dca";
  const workNetworkValueSats = "8193547095.322113";
  const workNetworkValueQ8 = "819354709532211300";
  const accountingModel = "canonical-unique-tx-input-output-v1";
  let rows = [];
  let queryText = "";
  let queryParams = [];
  let queryCount = 0;
  const safeBlockHeight = (value) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0
      ? Number(value)
      : 0;
  const canonicalSnapshotQ8Text = isolatedFunction(
    READER_PATH,
    "canonicalSnapshotQ8Text",
    { canonicalIntegerText },
  );
  const canonicalSummaryLedgerRowBinding = isolatedFunction(
    READER_PATH,
    "canonicalSummaryLedgerRowBinding",
    {
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      canonicalSnapshotQ8Text,
      decimalTextFromQ8,
      safeBlockHeight,
    },
  );
  const canonicalSummaryLedgerValueBindingsAgree = isolatedFunction(
    READER_PATH,
    "canonicalSummaryLedgerValueBindingsAgree",
  );
  const readCanonicalSummary = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalSummaryLedgerPayload",
    {
      canonicalSummaryLedgerRowBinding,
      canonicalSummaryLedgerValueBindingsAgree,
      dateIso: (value) => new Date(value).toISOString(),
      proofIndexPool: () => ({
        async query(sql, params) {
          queryCount += 1;
          queryText = String(sql);
          queryParams = Array.from(params);
          return { rows };
        },
      }),
      safeBlockHeight,
    },
  );
  const exactRow = ({
    canonicalSummaryHash = oldCanonicalSummaryHash,
    generatedAt = "2026-07-14T03:03:04.765Z",
    matchingSnapshotCount = 1,
    snapshotId = oldSnapshotId,
    valueQ8 = workNetworkValueQ8,
    valueAccountingModel = accountingModel,
  } = {}) => {
    const exactValues = exactCanonicalSummaryRowValueFixture(valueQ8, {
      creditMinerFeeAccountingModel: valueAccountingModel,
    });
    return {
    consistency: { ok: true, status: "green" },
    generated_at: generatedAt,
    growth_floor_height: height,
    growth_height: height,
    growth_snapshot_id: snapshotId,
    indexed_through_block: height,
    inception_height: height,
    inception_snapshot_id: snapshotId,
    infinity_height: height,
    infinity_snapshot_id: snapshotId,
    log_height: height,
    log_snapshot_id: snapshotId,
    marketplace_floor_height: height,
    marketplace_height: height,
    marketplace_snapshot_id: snapshotId,
    matching_snapshot_count: matchingSnapshotCount,
    metrics: { indexedThroughBlock: height },
    payload_indexed_through_block_hash: blockHash,
    payload_snapshot_id: snapshotId,
    snapshot_id: snapshotId,
    source_hashes: {
      blockScan: blockHash,
      canonicalSummary: canonicalSummaryHash,
    },
    summary_refresh_block_hash: blockHash,
    summary_refresh_mode: "canonical-summary-refresh",
    token_height: height,
    token_snapshot_id: snapshotId,
    ...exactValues,
    work_floor: {
      ...exactValues.work_floor,
      indexedThroughBlock: height,
      indexedThroughBlockHash: blockHash,
      snapshotId,
    },
    work_floor_block_hash: blockHash,
    work_floor_height: height,
    work_floor_snapshot_id: snapshotId,
    work_summary_floor_height: height,
    work_summary_height: height,
    work_summary_snapshot_id: snapshotId,
    };
  };

  const newestRow = exactRow({
    canonicalSummaryHash: newestCanonicalSummaryHash,
    generatedAt: "2026-07-14T03:04:30.000Z",
    matchingSnapshotCount: 2,
    snapshotId: newestSnapshotId,
  });
  const oldRow = exactRow({ matchingSnapshotCount: 2 });
  rows = [newestRow, oldRow];
  const preservedRows = structuredClone(rows);
  const exact = await readCanonicalSummary("livenet", height, blockHash);
  assert.equal(queryCount, 1);
  assert.deepEqual(queryParams, ["livenet", height, blockHash]);
  assert.doesNotMatch(queryText, /workAmountStorageModel/u);
  assert.match(queryText, /consistency->>'status'.*= 'green'/u);
  assert.match(
    queryText,
    /count\(\*\) OVER \(\) AS matching_snapshot_count/u,
  );
  assert.match(
    queryText,
    /ORDER BY\s+indexed_through_block DESC NULLS LAST,\s+generated_at DESC,\s+snapshot_id DESC/u,
  );
  assert.doesNotMatch(
    queryText,
    /\bLIMIT\b/u,
    "exact H-1 verification must inspect the full version set",
  );
  assert.doesNotMatch(queryText, /\b(?:INSERT|UPDATE|DELETE)\b/u);
  assert.deepEqual(rows, preservedRows);
  assert.equal(exact.snapshotId, newestSnapshotId);
  assert.equal(exact.generatedAt, "2026-07-14T03:04:30.000Z");
  assert.equal(exact.canonicalSummaryHash, newestCanonicalSummaryHash);
  assert.equal(exact.workNetworkValueSats, workNetworkValueSats);
  assert.equal(exact.workNetworkValueQ8, workNetworkValueQ8);

  const exactWorkNetworkQ8State = isolatedFunction(
    API_PATH,
    "exactWorkNetworkQ8State",
    {
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    },
  );
  const exactWorkFloorNetworkQ8State = isolatedFunction(
    API_PATH,
    "exactWorkFloorNetworkQ8State",
    {
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      exactWorkNetworkQ8State,
    },
  );
  const canonicalInceptionValueSnapshotCheckpoint = isolatedFunction(
    API_PATH,
    "canonicalInceptionValueSnapshotCheckpoint",
    {
      INCEPTION_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
      exactWorkFloorNetworkQ8State,
    },
  );
  const bond = {
    blockHash:
      "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5",
    blockHeight: height + 1,
    blockIndex: 382,
  };
  const bound = canonicalInceptionValueSnapshotCheckpoint(exact, bond);
  assert.equal(bound.valueSnapshotId, newestSnapshotId);
  assert.equal(bound.valueSnapshotBlockHash, blockHash);
  assert.equal(bound.workNetworkValueSats, "8193547095.322113");
  assert.equal(
    exact.workFloor.actualValue.creditMinerFeeAccountingModel,
    accountingModel,
  );
  assert.equal(
    canonicalInceptionValueSnapshotCheckpoint(
      {
        ...exact,
        workFloor: {
          ...exact.workFloor,
          actualValue: {
            ...exact.workFloor.actualValue,
            totalQ8: (BigInt(workNetworkValueQ8) + 1n).toString(),
          },
        },
      },
      bond,
    ),
    null,
  );
  assert.equal(
    canonicalInceptionValueSnapshotCheckpoint(
      { ...exact, indexedThroughBlockHash: "bad-hash" },
      bond,
    ),
    null,
  );

  rows = [];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
  );
  rows = [
    {
      ...exactRow(),
      source_hashes: {
        blockScan: "f".repeat(64),
        canonicalSummary: oldCanonicalSummaryHash,
      },
    },
  ];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
  );
  rows = [
    {
      ...exactRow(),
      consistency: { ok: true, status: "amber" },
    },
  ];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
  );

  const versionedRows = (older) => [
    { ...newestRow, matching_snapshot_count: 2 },
    { ...older, matching_snapshot_count: 2 },
  ];
  rows = versionedRows(exactRow({
    valueQ8: (BigInt(workNetworkValueQ8) + 1n).toString(),
  }));
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
    "same-height versions with divergent proof values must fail closed",
  );
  rows = versionedRows(exactRow({
    valueAccountingModel: "divergent-fee-accounting-model",
  }));
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
    "same-height versions with divergent accounting semantics must fail closed",
  );
  rows = versionedRows({
    ...exactRow(),
    work_floor_block_hash: "f".repeat(64),
  });
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
    "every version must preserve the exact checkpoint-hash binding",
  );
  rows = versionedRows({
    ...exactRow(),
    growth_height: height - 1,
  });
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
    "every version must preserve complete H-1 summary coverage",
  );
  rows = versionedRows({
    ...exactRow(),
    payload_snapshot_id: "mismatched-row-identity",
  });
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
    "every version must preserve its complete snapshot identity",
  );

  rows = [exactRow({ matchingSnapshotCount: 2 })];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
    "a truncated exact-checkpoint result must not select a partial version set",
  );
  rows = Array.from({ length: 129 }, (_value, index) =>
    exactRow({
      canonicalSummaryHash: (index + 1).toString(16).padStart(64, "0"),
      generatedAt: new Date(
        Date.UTC(2026, 6, 14, 4, 2, 8) - index * 1_000,
      ).toISOString(),
      matchingSnapshotCount: 129,
      snapshotId: `full-version-${String(index).padStart(3, "0")}`,
    })
  );
  const allAgreeingVersions = await readCanonicalSummary(
    "livenet",
    height,
    blockHash,
  );
  assert.equal(
    allAgreeingVersions.snapshotId,
    "full-version-000",
    "129 agreeing exact versions must select the newest full-set witness",
  );
  rows = rows.map((row, index) =>
    index === rows.length - 1
      ? exactRow({
          canonicalSummaryHash: row.source_hashes.canonicalSummary,
          generatedAt: row.generated_at,
          matchingSnapshotCount: 129,
          snapshotId: row.snapshot_id,
          valueQ8: (BigInt(workNetworkValueQ8) + 1n).toString(),
        })
      : row,
  );
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
    "a divergent 129th exact version must fail closed instead of hiding behind a cap",
  );
});

check("public consistency prefers the eligible database snapshot", async () => {
  let legacyReads = 0;
  const indexedLedger = {
    snapshotId: "current-summary",
    metrics: {
      activityItems: 23591,
      confirmedComputerActions: 23585,
    },
  };
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      ENABLE_REQUEST_LEDGER_RECOVERY: false,
      errorSummary: (error) => String(error?.message ?? error),
      ledgerPayloadCoversTip: async () => true,
      ledgerPayloadHasCurrentChecks: () => true,
      ledgerConsistencyPayloadFromLedger: (ledger) => ({
        metrics: ledger.metrics,
        snapshotId: ledger.snapshotId,
      }),
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCanonicalSummaryLedgerPayload: async () => indexedLedger,
      summaryCanonicalLedgerPayload: async () => {
        legacyReads += 1;
        return null;
      },
      verifiedSummaryPayloadCheckpoint: async () => ({ exactTip: true }),
    },
  );
  const result = await ledgerConsistencyPayload("livenet", true);
  assert.equal(result.snapshotId, indexedLedger.snapshotId);
  assert.equal(result.metrics.activityItems, 23591);
  assert.equal(legacyReads, 0);
});

check("credit directory reads the hash-bound database checkpoint", async () => {
  const snapshotId = "exact-token-checkpoint";
  let storedReads = 0;
  let provenanceReads = 0;
  const canonicalTokenDirectoryPayload = isolatedFunction(
    API_PATH,
    "canonicalTokenDirectoryPayload",
    {
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      normalizeTokenScope: (scope) => String(scope ?? "").trim(),
      paginatedHistoryPayload: ({ indexedAt, items, kind, network, pagination, source }) => ({
        indexedAt,
        indexedThroughBlock: 100,
        items: items.slice(pagination.offset, pagination.offset + pagination.limit),
        kind,
        network,
        source,
        totalCount: items.length,
      }),
      payloadIndexedThroughBlockHash: (payload) =>
        payload.indexedThroughBlockHash,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        payload.indexedThroughBlock,
      storedCanonicalTokenSummaryPayload: async () => {
        storedReads += 1;
        return {
          indexedAt: "2026-07-13T22:35:58.045Z",
          indexedThroughBlock: 957912,
          indexedThroughBlockHash: "a".repeat(64),
          snapshotId,
          source: "proof-index",
          tokens: [{ tokenId: "one" }, { tokenId: "two" }],
        };
      },
      summaryPayloadWithCanonicalProvenance: async (payload, network, fresh, surface) => {
        provenanceReads += 1;
        assert.equal(network, "livenet");
        assert.equal(fresh, true);
        assert.equal(surface, "token-directory:all");
        return {
          ...payload,
          provenance: { ready: true, served: "exact-tip" },
        };
      },
    },
  );
  const result = await canonicalTokenDirectoryPayload(
    "livenet",
    "",
    { limit: 1, offset: 0, query: "" },
    true,
  );
  assert.equal(storedReads, 1);
  assert.equal(provenanceReads, 1);
  assert.equal(result.totalCount, 2);
  assert.equal(result.items[0].tokenId, "one");
  assert.equal(result.indexedThroughBlock, 957912);
  assert.equal(result.indexedThroughBlockHash, "a".repeat(64));
  assert.equal(result.snapshotId, snapshotId);
  assert.equal(result.provenance.served, "exact-tip");
});

check("public consistency fails closed without an eligible database snapshot", async () => {
  let legacyReads = 0;
  let indexedLedger = null;
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      activitySummaryPayload: async () => ({
        indexedThroughBlock: 100,
        indexedThroughBlockHash: "a".repeat(64),
        snapshotId: "stable-summary",
      }),
      ENABLE_REQUEST_LEDGER_RECOVERY: false,
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      ledgerPayloadCoversTip: async () => true,
      ledgerPayloadHasCurrentChecks: (payload) =>
        payload?.eligible === true,
      payloadIndexedThroughBlockHash: (payload) =>
        payload?.indexedThroughBlockHash ?? "",
      payloadSnapshotId: (payload) => payload?.snapshotId ?? "",
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock ?? 0),
      proofIndexCanonicalSummaryLedgerPayload: async () => indexedLedger,
      summaryPayloadWithCanonicalProvenance: async (payload) => payload,
      summaryCanonicalLedgerPayload: async () => {
        legacyReads += 1;
        return null;
      },
    },
  );
  for (const candidate of [null, { eligible: false }]) {
    indexedLedger = candidate;
    await rejection(
      ledgerConsistencyPayload("livenet", false),
      (error) => error?.statusCode === 503,
    );
  }
  assert.equal(legacyReads, 0);
});

check("consistency recovery remains available only when explicitly enabled", async () => {
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      activitySummaryPayload: async () => ({}),
      ENABLE_REQUEST_LEDGER_RECOVERY: true,
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      ledgerConsistencyPayloadFromLedger: (ledger) => ({
        snapshotId: ledger.snapshotId,
      }),
      ledgerConsistencyPayloadWithCurrentSummaries: async (payload) => payload,
      ledgerPayloadCoversTip: async () => false,
      ledgerPayloadHasCurrentChecks: () => false,
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCanonicalSummaryLedgerPayload: async () => null,
      summaryPayloadWithCanonicalProvenance: async () => {
        throw new Error("No stable canonical summary is available.");
      },
      summaryCanonicalLedgerPayload: async () => ({
        snapshotId: "recovered-ledger",
      }),
    },
  );
  assert.equal(
    (await ledgerConsistencyPayload("livenet", false)).snapshotId,
    "recovered-ledger",
  );
});

check("legacy Log pagination honors offset and transaction aliases in both paths", () => {
  const apiBoundedInteger = isolatedFunction(API_PATH, "boundedInteger");
  const apiHistoryCursorOffset = isolatedFunction(
    API_PATH,
    "historyCursorOffset",
    { boundedInteger: apiBoundedInteger },
  );
  const apiPagination = isolatedFunction(
    API_PATH,
    "historyPaginationFromSearch",
    {
      HISTORY_PAGE_DEFAULT_LIMIT: 200,
      HISTORY_PAGE_MAX_LIMIT: 500,
      boundedInteger: apiBoundedInteger,
      historyCursorOffset: apiHistoryCursorOffset,
    },
  );
  const readerBoundedInteger = isolatedFunction(READER_PATH, "boundedInteger");
  const normalizedSnapshotId = isolatedFunction(
    READER_PATH,
    "normalizedSnapshotId",
  );
  const readerCursor = isolatedFunction(
    READER_PATH,
    "historyCursorFromSearch",
    {
      boundedInteger: readerBoundedInteger,
      normalizedSnapshotId,
    },
  );
  const readerPagination = isolatedFunction(
    READER_PATH,
    "historyPaginationFromSearch",
    {
      boundedInteger: readerBoundedInteger,
      historyCursorFromSearch: readerCursor,
      normalizedSnapshotId,
    },
  );
  for (const pagination of [apiPagination, readerPagination]) {
    const params = new URLSearchParams({
      limit: "2",
      offset: "7",
      page: "99",
      transactionId: "A".repeat(64),
    });
    const result = pagination(params);
    assert.equal(result.limit, 2);
    assert.equal(result.offset, 7);
    assert.equal(result.query, "a".repeat(64));

    params.set("cursor", "11");
    assert.equal(pagination(params).offset, 11, "cursor must outrank offset");
  }
});

check("recompacting summary-only payloads never turns truncated arrays into totals", () => {
  const compactTokenSummaryPayload = isolatedFunction(
    API_PATH,
    "compactTokenSummaryPayload",
    {
      SUMMARY_MARKET_LIMIT: 10,
      mergedTokenSummaryMetric: (token, summary, key) =>
        token?.[key] ?? summary?.[key],
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      recentByCreatedAt: (items, limit) =>
        (Array.isArray(items) ? items : []).slice(0, limit),
      recentClosedTokenListings: (items, limit) => items.slice(0, limit),
      tokenAggregateSummaries: () => new Map(),
      tokenListingHasConfirmedSaleTicketSeal: () => false,
      tokenMatchesScope: () => false,
      tokenPayloadWithScopedHolderIdentity: (payload) => payload,
      tokenSummaryListings: (items, limit) => items.slice(0, limit),
      tokenSummaryMetricValue: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : undefined,
    },
  );
  const compactRegistrySummaryPayload = isolatedFunction(
    API_PATH,
    "compactRegistrySummaryPayload",
    {
      SUMMARY_ACTIVITY_LIMIT: 10,
      SUMMARY_MARKET_LIMIT: 10,
      recentByCreatedAt: (items, limit) =>
        (Array.isArray(items) ? items : []).slice(0, limit),
    },
  );
  const tokenSummary = {
    closedListings: [{ listingId: "closed" }],
    collectionHasMore: {
      closedListings: true,
      listings: true,
      sales: true,
    },
    holders: [{ address: "holder", balance: 1 }],
    listings: [{ listingId: "open" }],
    mints: [{ confirmed: true }],
    sales: [{ confirmed: true, priceSats: 1 }],
    stats: {
      confirmedMints: 40,
      confirmedSales: 20,
      confirmedTokens: 3,
      confirmedTransfers: 30,
      holders: 100,
      pendingMints: 2,
      pendingSales: 1,
      pendingTokens: 0,
      pendingTransfers: 4,
      transactions: 999,
    },
    summaryOnly: true,
    tokens: [{ openListings: 77, tokenId: "token" }],
    transfers: [{ confirmed: true }],
  };
  const once = compactTokenSummaryPayload(tokenSummary);
  const twice = compactTokenSummaryPayload(once);
  assert.equal(twice.totalCounts.closedListings, null);
  assert.equal(twice.totalCounts.holders, 100);
  assert.equal(twice.totalCounts.listings, 77);
  assert.equal(twice.totalCounts.mints, 42);
  assert.equal(twice.totalCounts.sales, 21);
  assert.equal(twice.totalCounts.transfers, 34);
  assert.equal(twice.totalCount, 999);
  assert.equal(twice.collectionHasMore.closedListings, true);
  assert.equal(twice.tokens[0].confirmedSales, undefined);
  assert.equal(twice.tokens[0].confirmedSalesVolumeSats, undefined);
  assert.equal(twice.tokens[0].pendingSales, undefined);
  assert.equal(twice.tokens[0].pendingSalesVolumeSats, undefined);
  assert.equal(twice.tokens[0].confirmedOpenListings, undefined);
  assert.equal(twice.tokens[0].pendingOpenListings, undefined);

  const registryOnce = compactRegistrySummaryPayload({
    activity: [{ txid: "one" }],
    collectionHasMore: { listings: true },
    listings: [{ listingId: "one" }],
    pendingEvents: [{ txid: "pending" }],
    sales: [{ txid: "sale" }],
    stats: { pendingChanges: 8, total: 250 },
    summaryOnly: true,
  });
  const registryTwice = compactRegistrySummaryPayload(registryOnce);
  assert.equal(registryTwice.totalCounts.activity, 250);
  assert.equal(registryTwice.totalCounts.listings, null);
  assert.equal(registryTwice.totalCounts.pendingEvents, 8);
  assert.equal(registryTwice.totalCounts.sales, null);
  assert.equal(registryTwice.collectionHasMore.listings, true);
});

check("compact token definitions preserve per-token market totals beyond previews", () => {
  const tokenId = "a".repeat(64);
  const tokenListingHasConfirmedSaleTicketSeal = (listing) =>
    listing?.sealConfirmed === true;
  const tokenAggregateSummaries = isolatedFunction(
    API_PATH,
    "tokenAggregateSummaries",
    { tokenListingHasConfirmedSaleTicketSeal },
  );
  const tokenSummaryMetricValue = isolatedFunction(
    API_PATH,
    "tokenSummaryMetricValue",
  );
  const compactTokenSummaryPayload = isolatedFunction(
    API_PATH,
    "compactTokenSummaryPayload",
    {
      SUMMARY_MARKET_LIMIT: 40,
      mergedTokenSummaryMetric: (
        token,
        summary,
        key,
        preserveExisting,
      ) => {
        const existing = tokenSummaryMetricValue(token?.[key]);
        if (preserveExisting && existing !== undefined) {
          return existing;
        }
        return tokenSummaryMetricValue(summary?.[key]) ?? existing;
      },
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      recentByCreatedAt: (items, limit) =>
        (Array.isArray(items) ? items : []).slice(0, limit),
      recentClosedTokenListings: (items, limit) =>
        (Array.isArray(items) ? items : []).slice(0, limit),
      tokenAggregateSummaries,
      tokenListingHasConfirmedSaleTicketSeal,
      tokenMatchesScope: () => false,
      tokenPayloadWithScopedHolderIdentity: (payload) => payload,
      tokenSummaryListings: (items, limit) =>
        (Array.isArray(items) ? items : []).slice(0, limit),
      tokenSummaryMetricValue,
    },
  );
  const payload = {
    closedListings: [],
    holders: [],
    listings: [
      {
        amount: 3,
        confirmed: true,
        listingId: "1".repeat(64),
        priceSats: 300,
        tokenId,
      },
      {
        amount: 4,
        confirmed: false,
        listingId: "2".repeat(64),
        priceSats: 400,
        tokenId,
      },
    ],
    mints: [],
    sales: [
      {
        amount: 10,
        buyerAddress: "buyer",
        confirmed: true,
        priceSats: 100,
        sellerAddress: "seller",
        tokenId,
      },
      {
        amount: 5,
        buyerAddress: "pending-buyer",
        confirmed: false,
        priceSats: 250,
        sellerAddress: "seller",
        tokenId,
      },
    ],
    stats: {},
    tokens: [{ confirmed: true, ticker: "TEST", tokenId }],
    transfers: [],
  };
  const aggregated = tokenAggregateSummaries(payload).get(tokenId);
  assert.equal(aggregated.confirmedSales, 1);
  assert.equal(aggregated.confirmedSalesVolumeSats, 100);
  assert.equal(aggregated.pendingSales, 1);
  assert.equal(aggregated.pendingSalesVolumeSats, 250);
  assert.equal(aggregated.confirmedOpenListings, 1);
  assert.equal(aggregated.pendingOpenListings, 1);

  const once = compactTokenSummaryPayload(payload);
  const twice = compactTokenSummaryPayload(once);
  for (const compact of [once, twice]) {
    const token = compact.tokens[0];
    assert.equal(token.confirmedSales, 1);
    assert.equal(token.confirmedSalesVolumeSats, 100);
    assert.equal(token.pendingSales, 1);
    assert.equal(token.pendingSalesVolumeSats, 250);
    assert.equal(token.confirmedOpenListings, 1);
    assert.equal(token.pendingOpenListings, 1);
    assert.equal(compact.stats.confirmedSalesVolumeSats, 100);
    assert.equal(compact.stats.pendingSalesVolumeSats, 250);
  }
});

check("summary provenance rejects missing and mismatched required component IDs", async () => {
  const summaryPayloadRequiredComponents = isolatedFunction(
    API_PATH,
    "summaryPayloadRequiredComponents",
  );
  const payloadSnapshotId = isolatedFunction(API_PATH, "payloadSnapshotId");
  const freshDataUnavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const provenance = isolatedFunction(
    API_PATH,
    "summaryPayloadWithCanonicalProvenance",
    {
      freshDataUnavailableError,
      payloadSnapshotId,
      summaryPayloadRequiredComponents,
      verifiedSummaryPayloadCheckpoint: async () => ({
        exactTip: true,
        indexedThroughBlock: 100,
        indexedThroughBlockHash: "a".repeat(64),
        tipHash: "a".repeat(64),
        tipHeight: 100,
      }),
    },
  );
  const base = {
    indexedThroughBlock: 100,
    indexedThroughBlockHash: "a".repeat(64),
    registry: { snapshotId: "snapshot" },
    snapshotId: "snapshot",
    token: {},
    workFloor: { snapshotId: "snapshot" },
  };
  const missing = await rejection(
    provenance(base, "livenet", true, "marketplace-summary"),
    (error) => error?.details?.code === "CANONICAL_SUMMARY_INCOHERENT",
  );
  assert.deepEqual(Array.from(missing.details.missingSnapshotIds), ["token"]);

  await rejection(
    provenance(
      { ...base, token: { snapshotId: "other" } },
      "livenet",
      true,
      "marketplace-summary",
    ),
    (error) => error?.details?.code === "CANONICAL_SUMMARY_INCOHERENT",
  );

  const accepted = await provenance(
    { ...base, token: { snapshotId: "snapshot" } },
    "livenet",
    true,
    "marketplace-summary",
  );
  assert.equal(accepted.provenance.coherent, true);
  assert.equal(accepted.provenance.served, "exact-tip");
  assert.equal(accepted.provenance.componentSnapshotIds.token, "snapshot");
});

check("fresh summary checkpoint verification detects a same-height reorg race", async () => {
  const payloadIndexedThroughBlockHash = isolatedFunction(
    API_PATH,
    "payloadIndexedThroughBlockHash",
  );
  const proofIndexPayloadIndexedThroughBlock = isolatedFunction(
    API_PATH,
    "proofIndexPayloadIndexedThroughBlock",
  );
  const freshDataUnavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);
  const gates = [
    {
      canonicalHash: firstHash,
      ok: true,
      ready: true,
      storedHash: firstHash,
      tipHeight: 100,
    },
    {
      canonicalHash: secondHash,
      ok: true,
      ready: true,
      storedHash: secondHash,
      tipHeight: 100,
    },
  ];
  const verify = isolatedFunction(
    API_PATH,
    "verifiedSummaryPayloadCheckpoint",
    {
      canonicalBlockHashAtHeight: async () => firstHash,
      canonicalPublicReadGate: async (_network, options) => {
        assert.equal(options.force, true);
        return gates.shift();
      },
      freshDataUnavailableError,
      payloadIndexedThroughBlockHash,
      proofIndexPayloadIndexedThroughBlock,
    },
  );
  await rejection(
    verify(
      { indexedThroughBlock: 100, indexedThroughBlockHash: firstHash },
      "livenet",
      true,
      "work-floor",
    ),
    (error) => error?.details?.code === "CANONICAL_SUMMARY_TIP_CHANGED",
  );
});

check("broadcast rate identity trusts only the loopback proxy boundary", () => {
  const broadcastClientKey = isolatedFunction(
    API_PATH,
    "broadcastClientKey",
  );
  assert.equal(
    broadcastClientKey({
      headers: { "x-forwarded-for": "203.0.113.7, 10.77.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    }),
    "203.0.113.7",
  );
  assert.equal(
    broadcastClientKey({
      headers: { "x-forwarded-for": "203.0.113.8" },
      socket: { remoteAddress: "10.77.0.1" },
    }),
    "10.77.0.1",
  );
});

check("broadcast rejects absent origins and a checkpoint change before submit", async () => {
  const allowed = isolatedFunction(API_PATH, "broadcastOriginAllowed", {
    BROADCAST_ALLOW_MISSING_ORIGIN: false,
    BROADCAST_EXTRA_ALLOWED_ORIGINS: new Set(),
    URL,
  });
  assert.equal(allowed({ headers: {} }), false);
  assert.equal(
    allowed({ headers: { origin: "https://wallet.proofofwork.me" } }),
    true,
  );

  const firstHash = "c".repeat(64);
  const secondHash = "d".repeat(64);
  const gates = [
    {
      canonicalHash: firstHash,
      ready: true,
      storedHash: firstHash,
      tipHeight: 100,
    },
    {
      canonicalHash: secondHash,
      ready: true,
      storedHash: secondHash,
      tipHeight: 100,
    },
  ];
  let submitted = false;
  const admission = isolatedFunction(API_PATH, "withBroadcastAdmission", {
    BROADCAST_CONCURRENCY_MAX: 4,
    broadcastActiveRequests: 0,
    broadcastOriginAllowed: () => true,
    canonicalPublicReadGate: async (_network, options) => {
      assert.equal(options.force, true);
      return gates.shift();
    },
    consumeBroadcastRateLimit: () => {},
    freshDataUnavailableError: (message) => {
      const error = new Error(message);
      error.statusCode = 503;
      return error;
    },
  });
  await rejection(
    admission(
      { headers: {} },
      "livenet",
      async ({ beforeSubmit }) => {
        await beforeSubmit();
        submitted = true;
      },
      { requireCanonical: true },
    ),
    (error) => error?.details?.code === "BROADCAST_CANONICAL_CHECKPOINT_CHANGED",
  );
  assert.equal(submitted, false);
});

check("slow broadcast bodies time out and release every concurrency lane", async () => {
  class SlowRequest extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.headers = {};
    }

    destroy() {
      this.destroyed = true;
    }

    setEncoding() {}
  }

  const requestBodyReadError = isolatedFunction(
    API_PATH,
    "requestBodyReadError",
  );
  const readRequestBody = isolatedFunction(API_PATH, "readRequestBody", {
    clearTimeout,
    requestBodyReadError,
    setTimeout,
  });
  const admission = isolatedFunction(API_PATH, "withBroadcastAdmission", {
    BROADCAST_CONCURRENCY_MAX: 4,
    broadcastActiveRequests: 0,
    broadcastOriginAllowed: () => true,
    broadcastRateLimitError: (message, code) => {
      const error = new Error(message);
      error.statusCode = 429;
      error.details = { code };
      return error;
    },
    consumeBroadcastRateLimit: () => {},
  });
  const requests = Array.from({ length: 4 }, () => new SlowRequest());
  const keeper = setTimeout(() => {}, 100);
  try {
    const occupied = requests.map((request) =>
      admission(request, "testnet", () =>
        readRequestBody(request, 1_000, {
          label: "Broadcast request body",
          timeoutMs: 15,
        }),
      ),
    );
    await rejection(
      admission(new SlowRequest(), "testnet", async () => "unexpected"),
      (error) => error?.details?.code === "BROADCAST_CONCURRENCY_LIMIT",
    );
    const settled = await Promise.allSettled(occupied);
    assert.equal(
      settled.every(
        (result) =>
          result.status === "rejected" &&
          result.reason?.details?.code === "REQUEST_BODY_TIMEOUT",
      ),
      true,
    );
    assert.equal(requests.every((request) => request.destroyed), true);
    assert.equal(
      requests.every(
        (request) =>
          request.listenerCount("data") === 0 &&
          request.listenerCount("end") === 0 &&
          request.listenerCount("error") === 0,
      ),
      true,
      "timed-out body listeners were not cleaned up",
    );
    assert.equal(
      await admission(new SlowRequest(), "testnet", async () => "released"),
      "released",
    );
  } finally {
    clearTimeout(keeper);
  }
});

check("fresh consistency fails closed when its database snapshot is not exact-tip", async () => {
  const freshDataUnavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      ENABLE_REQUEST_LEDGER_RECOVERY: false,
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      freshDataUnavailableError,
      ledgerConsistencyPayloadFromLedger: (ledger) => ledger,
      ledgerPayloadHasCurrentChecks: () => true,
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCanonicalSummaryLedgerPayload: async () => ({
        indexedThroughBlock: 99,
        indexedThroughBlockHash: "e".repeat(64),
        snapshotId: "stale",
      }),
      summaryCanonicalLedgerPayload: async () => null,
      verifiedSummaryPayloadCheckpoint: async () => {
        throw freshDataUnavailableError("not exact");
      },
    },
  );
  await rejection(
    ledgerConsistencyPayload("livenet", true),
    (error) => error?.statusCode === 503,
  );
});

check("both consistency routes require an eligible summary snapshot", () => {
  const applies = isolatedFunction(
    API_PATH,
    "canonicalSummarySnapshotReadGateApplies",
  );
  assert.equal(applies("/api/v1/consistency"), true);
  assert.equal(applies("/api/v1/ledger-consistency"), true);
});

check("marketplace mutation accounting counts one registry payment per transaction", () => {
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const activityAmountSats = isolatedFunction(
    API_PATH,
    "activityAmountSats",
  );
  const ID_MARKETPLACE_MUTATION_KINDS = new Set([
    "id-list",
    "id-seal",
    "id-delist",
    "id-buy",
  ]);
  const TOKEN_MARKETPLACE_MUTATION_KINDS = new Set([
    "token-listing",
    "token-listing-sealed",
    "token-listing-closed",
  ]);
  const MARKETPLACE_MUTATION_KINDS = new Set([
    ...ID_MARKETPLACE_MUTATION_KINDS,
    ...TOKEN_MARKETPLACE_MUTATION_KINDS,
  ]);
  const marketplaceMutationPaymentSats = isolatedFunction(
    API_PATH,
    "marketplaceMutationPaymentSats",
    { numericValue },
  );
  const marketplaceMutationPaymentIdentity = isolatedFunction(
    API_PATH,
    "marketplaceMutationPaymentIdentity",
    {
      ID_MARKETPLACE_MUTATION_KINDS,
      MARKETPLACE_MUTATION_KINDS,
    },
  );
  const uniqueMarketplaceMutationActivity = isolatedFunction(
    API_PATH,
    "uniqueMarketplaceMutationActivity",
    {
      MARKETPLACE_MUTATION_KINDS,
      marketplaceMutationPaymentIdentity,
      marketplaceMutationPaymentSats,
    },
  );
  const marketplaceMutationPaymentFlowSats = isolatedFunction(
    API_PATH,
    "marketplaceMutationPaymentFlowSats",
    {
      MARKETPLACE_MUTATION_KINDS,
      marketplaceMutationPaymentSats,
      uniqueMarketplaceMutationActivity,
    },
  );
  const confirmedActivityFlowSats = isolatedFunction(
    API_PATH,
    "confirmedActivityFlowSats",
    {
      MARKETPLACE_MUTATION_KINDS,
      activityAmountSats,
      marketplaceMutationPaymentFlowSats,
    },
  );
  const duplicateTxid =
    "a18c2972590631e0a53bf47a2b1a737c39142136994faf2fd04247f7c1628749";
  const registryAddress = "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn";
  const seal = {
    amountSats: 546,
    confirmed: true,
    kind: "token-listing-sealed",
    marketplaceMutationFeeSats: 546,
    registryAddress,
    txid: duplicateTxid,
  };
  const close = {
    ...seal,
    kind: "token-listing-closed",
  };
  const closeWithoutRegistry = {
    ...close,
    registryAddress: "",
  };
  const listing = {
    ...seal,
    kind: "token-listing",
    txid: "b".repeat(64),
  };
  const sellerSale = {
    amountSats: 3_374_237,
    confirmed: true,
    kind: "token-sale",
    priceSats: 3_373_145,
    txid: "c".repeat(64),
  };
  const activity = [seal, close, listing, sellerSale];

  assert.equal(
    marketplaceMutationPaymentIdentity(seal),
    marketplaceMutationPaymentIdentity(close),
  );
  assert.equal(
    uniqueMarketplaceMutationActivity(
      activity,
      TOKEN_MARKETPLACE_MUTATION_KINDS,
    ).length,
    2,
  );
  assert.equal(
    uniqueMarketplaceMutationActivity(
      [seal, closeWithoutRegistry],
      TOKEN_MARKETPLACE_MUTATION_KINDS,
    ).length,
    1,
    "a blank duplicate projection inherits the sole registry for its transaction",
  );
  assert.equal(
    uniqueMarketplaceMutationActivity(
      [
        { ...seal, registryAddress: "" },
        closeWithoutRegistry,
      ],
      TOKEN_MARKETPLACE_MUTATION_KINDS,
    ).length,
    2,
    "ambiguous blank payment identities fail separate instead of collapsing",
  );
  assert.equal(
    marketplaceMutationPaymentFlowSats(
      activity,
      TOKEN_MARKETPLACE_MUTATION_KINDS,
    ),
    1_092,
  );
  assert.equal(
    confirmedActivityFlowSats(
      activity,
      TOKEN_MARKETPLACE_MUTATION_KINDS,
    ),
    1_092,
    "seller paidSats must not replace priceSats or enter mutation fees",
  );
});

check("grouped proof-index deltas use one verified marketplace payment per transaction", () => {
  const normalizeDeltaRows = isolatedFunction(
    READER_PATH,
    "proofIndexConfirmedValueEventDeltaFromRows",
  );
  const growthDeltaForProofIndexEvents = isolatedFunction(
    API_PATH,
    "growthDeltaForProofIndexEvents",
    {
      GROWTH_MODEL_INPUTS: { valueMultiple: 5 },
      INCEPTION_BOND_KIND: "inception-bond",
      INFINITY_BOND_KIND: "infinity-bond",
    },
  );
  const duplicateTxid =
    "a18c2972590631e0a53bf47a2b1a737c39142136994faf2fd04247f7c1628749";
  const registryAddress = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
  const baseRow = {
    event_count: 1,
    expected_min_sats: "546",
    generated_at: "2026-07-16T16:00:00.000Z",
    indexed_through_block: 958_313,
    kind: "token-listing",
    marketplace_payment: true,
    max_event_block: 950_667,
    max_event_time: "2026-05-23T12:07:29.000Z",
    txid: duplicateTxid,
  };
  const payload = normalizeDeltaRows(
    [
      {
        ...baseRow,
        payment_verified: true,
        registry_address: registryAddress,
        total_sats: "546",
      },
      {
        ...baseRow,
        payment_verified: false,
        registry_address: "",
        total_sats: "0",
      },
    ],
    "livenet",
  );

  assert.ok(payload);
  assert.equal(payload.totalCount, 2);
  assert.equal(payload.totalSats, 546);
  assert.equal(payload.events.length, 1);
  assert.deepEqual(
    {
      count: payload.events[0].count,
      fee: payload.events[0].marketplaceMutationFeeSats,
      kind: payload.events[0].kind,
      registryAddress: payload.events[0].registryAddress,
      totalSats: payload.events[0].totalSats,
      txid: payload.events[0].txid,
      verified: payload.events[0].marketplacePaymentVerified,
    },
    {
      count: 2,
      fee: 546,
      kind: "token-listing",
      registryAddress,
      totalSats: 546,
      txid: duplicateTxid,
      verified: true,
    },
  );

  const delta = growthDeltaForProofIndexEvents(payload.events);
  assert.equal(delta.tokenMarketplaceFeeSats, 546);
  assert.equal(delta.marketplaceMutationFeeSats, 546);
  assert.equal(delta.marketplaceFlowSats, 546);
  assert.equal(delta.marketplaceSats, 2_730);
  assert.equal(delta.totalSats, 2_730);

  assert.equal(
    normalizeDeltaRows(
      [
        {
          ...baseRow,
          payment_verified: false,
          registry_address: "",
          total_sats: "0",
        },
      ],
      "livenet",
    ),
    null,
    "a marketplace delta without a registry payment must fail closed",
  );
  assert.equal(
    normalizeDeltaRows(
      [
        {
          ...baseRow,
          payment_verified: true,
          registry_address: registryAddress,
          total_sats: "546",
        },
        {
          ...baseRow,
          payment_verified: true,
          registry_address: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
          total_sats: "546",
        },
        {
          ...baseRow,
          payment_verified: false,
          registry_address: "",
          total_sats: "0",
        },
      ],
      "livenet",
    ),
    null,
    "a blank registry cannot inherit an ambiguous marketplace payment",
  );
});

check("WORK replay counts one canonical miner fee without collapsing same-tx movements", () => {
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const creditMovementIdentity = isolatedFunction(
    API_PATH,
    "creditMovementIdentity",
    { numericValue },
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const verifiedCanonicalMinerFeeCoverage = isolatedFunction(
    API_PATH,
    "verifiedCanonicalMinerFeeCoverage",
  );
  const compareCreditValueReplayEvents = (left, right) =>
    left.createdMs - right.createdMs ||
    left.order - right.order ||
    String(left.txid ?? "").localeCompare(String(right.txid ?? ""));
  const creditNetworkValueMetrics = isolatedFunction(
    API_PATH,
    "creditNetworkValueMetrics",
    {
      CREDIT_MINER_FEE_ACCOUNTING_MODEL:
        "canonical-unique-tx-input-output-v1",
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
      compareCreditValueReplayEvents,
      creditMovementIdentity,
      creditReplayTransactionMinerFeeSats,
      creditValueEventMs: (item) => Number(item?.createdMs),
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor: () => true,
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  const tokenId = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const txid = "7".repeat(64);
  const metrics = creditNetworkValueMetrics({
    baseValueAt: () => 1_000,
    confirmedActivity: [
      {
        canonicalMinerFeeSats: 77,
        canonicalMinerFeeCovered: true,
        confirmed: true,
        createdMs: 100,
        kind: "token-transfer",
        minerFeeSats: 999,
        tokenId,
        txid,
      },
    ],
    canonicalMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 1,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 1,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
    cutoffMs: 200,
    includeEvents: true,
    tokenDefinitions: [
      { maxSupply: 1_000, ticker: "WORK", tokenId },
    ],
    tokenTransfers: [
      {
        amount: 10,
        confirmed: true,
        createdMs: 100,
        eventId: 1,
        minerFeeSats: 999,
        paidSats: 546,
        tokenId,
        txid,
      },
      {
        amount: 10,
        confirmed: true,
        createdMs: 100,
        eventId: 2,
        minerFeeSats: 999,
        paidSats: 546,
        tokenId,
        txid,
      },
    ],
  });

  assert.equal(metrics.events.length, 2);
  assert.equal(
    metrics.events.reduce((total, event) => total + event.amount, 0),
    20,
    "both WORK movements remain in the replay",
  );
  assert.equal(metrics.creditRegistryMutationFlowSats, 1_092);
  assert.equal(metrics.creditMinerFeeFlowSats, 77);
  assert.equal(
    metrics.creditMinerFeeAccountingModel,
    "canonical-unique-tx-input-output-v1",
  );
  const missingPerTxProof = creditNetworkValueMetrics({
    baseValueAt: () => 1_000,
    canonicalMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 1,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 1,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
    confirmedActivity: [
      {
        confirmed: true,
        createdMs: 100,
        kind: "token-transfer",
        minerFeeSats: 999,
        tokenId,
        txid,
      },
    ],
    cutoffMs: 200,
    tokenDefinitions: [
      { maxSupply: 1_000, ticker: "WORK", tokenId },
    ],
    tokenTransfers: [
      {
        amount: 10,
        confirmed: true,
        createdMs: 100,
        eventId: 1,
        minerFeeSats: 999,
        paidSats: 546,
        tokenId,
        txid,
      },
    ],
  });
  assert.equal(missingPerTxProof.creditMinerFeeAccountingModel, undefined);
  assert.equal(missingPerTxProof.creditMinerFeeFlowSats, 0);
  assert.deepEqual(
    Array.from(metrics.events, (event) => event.transactionMinerFeeSats),
    [77, 77],
  );
  assert.equal(
    metrics.events.reduce((total, event) => total + event.minerFeeSats, 0),
    77,
  );
  assert.ok(metrics.creditMovementFrozenValueSats > 0);
  assert.notEqual(
    metrics.events[0].movementIdentity,
    metrics.events[1].movementIdentity,
  );
  const tokenStateWithCreditNetworkValueDetails = isolatedFunction(
    API_PATH,
    "tokenStateWithCreditNetworkValueDetails",
    {
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      creditMovementIdentity,
      numericValue,
      tokenCanUseCreditNetworkFloor: () => true,
      tokenStateWithPendingStats: (state) => state,
    },
  );
  const enrichedState = tokenStateWithCreditNetworkValueDetails(
    {
      closedListings: [],
      listings: [],
      mints: [],
      sales: [],
      tokens: [{ ticker: "WORK", tokenId }],
      transfers: [
        {
          amount: 10,
          confirmed: true,
          createdMs: 100,
          eventId: 1,
          paidSats: 546,
          tokenId,
          txid,
        },
        {
          amount: 10,
          confirmed: true,
          createdMs: 100,
          eventId: 2,
          paidSats: 546,
          tokenId,
          txid,
        },
      ],
    },
    metrics,
  );
  assert.notEqual(
    enrichedState.transfers[0].creditValueAtConfirmSats,
    enrichedState.transfers[1].creditValueAtConfirmSats,
    "eventId-only movements must retain their distinct replay valuations",
  );
  assert.ok(
    Math.abs(
      metrics.creditEventFrozenValueSats -
        (metrics.creditMovementFrozenValueSats + 1_092 + 77),
    ) < 1e-9,
  );
});

check("Inception-bound WORK movements freeze once at each bond's own H-1 live oracle", () => {
  const WORK_TOKEN_ID =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const INCB_TOKEN_ID =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
  const INCEPTION_WORK_MOVEMENT_ORACLE_MODEL =
    "canonical-incb-h-minus-one-live-work-v1";
  const recipientAddress = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
  const attachedWorkAmount = 3_644_060;
  const first = {
    blockHash:
      "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5",
    blockHeight: 957_950,
    blockIndex: 382,
    createdMs: 100,
    snapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    snapshotBlockHeight: 957_949,
    snapshotId: "b8e77cd30cbed6855977c514",
    txid: "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4",
    workNetworkValueSats: 8_193_547_095.322113,
  };
  const second = {
    blockHash:
      "00000000000000000000db5329facae5d3bdd11f7d2e9df4bdcdda580069afa9",
    blockHeight: 958_007,
    blockIndex: 1_079,
    createdMs: 200,
    snapshotBlockHash:
      "00000000000000000000a9c98064bcf92b25b7c43576c8479befdcb17dfb85cd",
    snapshotBlockHeight: 958_006,
    snapshotId: "c8b800384da576c962ae82a5",
    txid: "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21",
    workNetworkValueSats: 9_857_361_066.004198,
  };
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const numbersAgree = (left, right, tolerance = 0) =>
    Math.abs(Number(left) - Number(right)) <= tolerance;
  const samePaymentAddress = (left, right) =>
    String(left ?? "").trim() === String(right ?? "").trim();
  const creditMovementIdentity = isolatedFunction(
    API_PATH,
    "creditMovementIdentity",
    { numericValue },
  );
  const issuanceMetadataFromMint = (mints) => {
    const mint = Array.isArray(mints) ? mints[0] : null;
    if (!mint?.validCanonicalIssuance) {
      return {
        attachedWorkAmount: 0,
        canonicalMints: 0,
        complete: false,
        confirmedMints: mint ? 1 : 0,
      };
    }
    return {
      attachedWorkAmount: mint.attachedWorkAmount,
      attachedWorkAmountAtoms: parseWorkAmountToAtoms(
        mint.attachedWorkAmount,
      ),
      attachedWorkLiveValueAtSendSats:
        mint.attachedWorkLiveValueAtSendSats,
      attachedWorkLiveValueAtSendQ8:
        mint.attachedWorkLiveValueAtSendQ8,
      canonicalMints: 1,
      complete: true,
      confirmedMints: 1,
      issuanceValueSnapshotBlockHash:
        mint.issuanceValueSnapshotBlockHash,
      issuanceValueSnapshotBlockHeight:
        mint.issuanceValueSnapshotBlockHeight,
      issuanceValueSnapshotCanonicalSummaryHash:
        mint.issuanceValueSnapshotCanonicalSummaryHash,
      issuanceValueSnapshotGeneratedAt:
        mint.issuanceValueSnapshotGeneratedAt,
      issuanceValueSnapshotId: mint.issuanceValueSnapshotId,
      issuanceValueSnapshotWorkNetworkValueSats:
        mint.issuanceValueSnapshotWorkNetworkValueSats,
      issuanceValueSnapshotWorkNetworkValueQ8:
        mint.issuanceValueSnapshotWorkNetworkValueQ8,
    };
  };
  const canonicalInceptionWorkMovementOracleByIdentity = isolatedFunction(
    API_PATH,
    "canonicalInceptionWorkMovementOracleByIdentity",
    {
      INCB_TOKEN_ID,
      INCEPTION_WORK_MOVEMENT_ORACLE_MODEL,
      WORK_TOKEN_ID,
      WORK_TOKEN_MAX_SUPPLY,
      creditMovementIdentity,
      inceptionIssuanceMetadataFromMints: issuanceMetadataFromMint,
      numbersAgree,
      numericValue,
      samePaymentAddress,
    },
  );
  const transferFor = (bond) => ({
    _powEventIndex: 2,
    amount: attachedWorkAmount,
    blockHash: bond.blockHash,
    blockHeight: bond.blockHeight,
    blockIndex: bond.blockIndex,
    confirmed: true,
    createdMs: bond.createdMs,
    minerFeeSats: 0,
    network: "livenet",
    paidSats: 546,
    protocolVout: 3,
    recipientAddress,
    senderAddress: recipientAddress,
    tokenId: WORK_TOKEN_ID,
    txid: bond.txid,
  });
  const mintFor = (bond) => {
    const workNetworkValueQ8 =
      bond.workNetworkValueQ8 ?? q8TextFromDecimal(bond.workNetworkValueSats);
    const attachedWorkLiveValueAtSendQ8 = workAtomsValueAtNetworkQ8(
      parseWorkAmountToAtoms(String(attachedWorkAmount)),
      bond.workNetworkValueSats,
      workNetworkValueQ8,
    ).toString();
    const attachedWorkLiveValueAtSendSats = decimalTextFromQ8(
      attachedWorkLiveValueAtSendQ8,
    );
    return {
      attachedWorkAmount,
      attachedWorkLiveValueAtSendSats,
      attachedWorkLiveValueAtSendQ8,
      bondRecipientAddress: recipientAddress,
      confirmed: true,
      issuanceCheckpointBlockHash: bond.blockHash,
      issuanceCheckpointBlockHeight: bond.blockHeight,
      issuanceCheckpointBlockIndex: bond.blockIndex,
      issuanceValueSnapshotBlockHash: bond.snapshotBlockHash,
      issuanceValueSnapshotBlockHeight: bond.snapshotBlockHeight,
      issuanceValueSnapshotCanonicalSummaryHash: "a".repeat(64),
      issuanceValueSnapshotGeneratedAt: "2026-07-14T13:05:51.033Z",
      issuanceValueSnapshotId: bond.snapshotId,
      issuanceValueSnapshotWorkNetworkValueSats:
        bond.workNetworkValueSats,
      issuanceValueSnapshotWorkNetworkValueQ8: workNetworkValueQ8,
      tokenId: INCB_TOKEN_ID,
      txid: bond.txid,
      validCanonicalIssuance: true,
    };
  };
  const firstTransfer = transferFor(first);
  const secondTransfer = transferFor(second);
  const firstMint = mintFor(first);
  const secondMint = mintFor(second);

  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const verifiedCanonicalMinerFeeCoverage = isolatedFunction(
    API_PATH,
    "verifiedCanonicalMinerFeeCoverage",
  );
  const creditNetworkValueMetrics = isolatedFunction(
    API_PATH,
    "creditNetworkValueMetrics",
    {
      CREDIT_MINER_FEE_ACCOUNTING_MODEL:
        "canonical-unique-tx-input-output-v1",
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity,
      compareCreditValueReplayEvents: (left, right) =>
        left.createdMs - right.createdMs || left.order - right.order,
      creditMovementIdentity,
      creditReplayTransactionMinerFeeSats,
      creditValueEventMs: (item) => Number(item?.createdMs),
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor: (token) =>
        token?.tokenId === WORK_TOKEN_ID,
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  const baseValueAt = () => 50_000_000;
  const metrics = creditNetworkValueMetrics({
    baseValueAt,
    cutoffMs: 300,
    includeEvents: true,
    tokenDefinitions: [
      {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    tokenMints: [firstMint, secondMint],
    tokenTransfers: [firstTransfer, secondTransfer],
  });
  const firstEvent = metrics.events.find((event) => event.txid === first.txid);
  const secondEvent = metrics.events.find(
    (event) => event.txid === second.txid,
  );
  const firstExpectedValue =
    attachedWorkAmount *
    (first.workNetworkValueSats / WORK_TOKEN_MAX_SUPPLY);
  const secondExpectedValue =
    attachedWorkAmount *
    (second.workNetworkValueSats / WORK_TOKEN_MAX_SUPPLY);

  assert.equal(metrics.events.length, 2);
  assert.equal(
    metrics.events.filter((event) => event.txid === first.txid).length,
    1,
  );
  assert.equal(
    metrics.events.filter((event) => event.txid === second.txid).length,
    1,
  );
  assert.equal(
    firstEvent.creditFloorAtConfirmModel,
    INCEPTION_WORK_MOVEMENT_ORACLE_MODEL,
  );
  assert.equal(
    secondEvent.creditFloorAtConfirmModel,
    INCEPTION_WORK_MOVEMENT_ORACLE_MODEL,
  );
  assert.ok(
    Math.abs(
      firstEvent.creditFloorAtConfirmSats -
        Number(
          decimalTextFromQ8(
            BigInt(firstMint.issuanceValueSnapshotWorkNetworkValueQ8) /
              BigInt(WORK_TOKEN_MAX_SUPPLY),
          ),
        ),
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      secondEvent.creditFloorAtConfirmSats -
        Number(
          decimalTextFromQ8(
            BigInt(secondMint.issuanceValueSnapshotWorkNetworkValueQ8) /
              BigInt(WORK_TOKEN_MAX_SUPPLY),
          ),
        ),
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(firstEvent.creditValueAtConfirmSats - firstExpectedValue) < 0.01,
  );
  assert.ok(
    Math.abs(secondEvent.creditValueAtConfirmSats - secondExpectedValue) <
      0.01,
  );
  assert.ok(
    Math.abs(
      metrics.creditMovementFrozenValueSats -
        (firstExpectedValue + secondExpectedValue),
    ) < 0.01,
    "each attached WORK movement must enter frozen value exactly once",
  );
  assert.equal(firstEvent.valueSnapshotBlockHeight, first.snapshotBlockHeight);
  assert.equal(
    secondEvent.valueSnapshotBlockHeight,
    second.snapshotBlockHeight,
  );

  const exactNetworkValueQ8 = "900719925474099312345678";
  const exactBond = {
    ...second,
    blockHash: "c".repeat(64),
    blockHeight: 958100,
    blockIndex: 77,
    createdMs: 250,
    snapshotBlockHash: "d".repeat(64),
    snapshotBlockHeight: 958099,
    snapshotId: "exact-over-safe-integer-snapshot",
    txid: "e".repeat(64),
    workNetworkValueQ8: exactNetworkValueQ8,
    workNetworkValueSats: "9007199254740993.12345678",
  };
  const exactTransfer = transferFor(exactBond);
  const exactMint = mintFor(exactBond);
  const exactOracle = canonicalInceptionWorkMovementOracleByIdentity(
    [exactMint],
    [exactTransfer],
  ).get(creditMovementIdentity(exactTransfer, "transfer"));
  const exactAttachedValueQ8 = workAtomsValueAtNetworkQ8(
    parseWorkAmountToAtoms(String(attachedWorkAmount)),
    exactBond.workNetworkValueSats,
    exactNetworkValueQ8,
  );
  assert.equal(exactOracle.workNetworkValueQ8, exactNetworkValueQ8);
  assert.equal(
    exactOracle.workNetworkValueSats,
    exactBond.workNetworkValueSats,
    "the H-1 decimal must remain a canonical string above Number.MAX_SAFE_INTEGER",
  );
  const exactMetrics = creditNetworkValueMetrics({
    baseValueAt,
    cutoffMs: 300,
    includeEvents: true,
    tokenDefinitions: [
      {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    tokenMints: [exactMint],
    tokenTransfers: [exactTransfer],
  });
  const exactEvent = exactMetrics.events[0];
  assert.equal(
    exactEvent.creditValueAtConfirmQ8,
    exactAttachedValueQ8.toString(),
  );
  assert.equal(
    exactEvent.frozenNetworkValueQ8,
    (exactAttachedValueQ8 + 546n * VALUE_Q8_SCALE).toString(),
  );
  assert.equal(exactEvent.liveNetworkValueBeforeEventQ8, exactNetworkValueQ8);

  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const growthActualLiveTotalSatsAtProvider = isolatedFunction(
    API_PATH,
    "growthActualLiveTotalSatsAtProvider",
    {
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity,
      canonicalReplayPrefixLengthAtMs,
      canonicalReplayTimeline,
      compareCreditValueReplayEvents: (left, right) =>
        left.createdMs - right.createdMs || left.order - right.order,
      creditMovementIdentity,
      creditReplayTransactionMinerFeeSats,
      creditValueEventMs: (item) => Number(item?.createdMs),
      growthActualBaseNetworkValueAtProvider: () => () => 50_000_000,
      growthActualBaseNetworkValueBeforeCanonicalItemProvider:
        (_collections, provider) => (_source, createdMs) =>
          provider(createdMs - 1),
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor: (token) =>
        token?.tokenId === WORK_TOKEN_ID,
    },
  );
  const growthTotalAt = growthActualLiveTotalSatsAtProvider(
    [],
    [],
    [],
    [
      {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    [firstMint, secondMint],
    [firstTransfer, secondTransfer],
    [],
  );
  const movementLiveFactor = attachedWorkAmount / WORK_TOKEN_MAX_SUPPLY;
  const fixedTransferFlowSats = 546;
  const expectedAfterFirst =
    50_000_000 +
    (50_000_000 + firstExpectedValue + fixedTransferFlowSats) *
      movementLiveFactor +
    fixedTransferFlowSats;
  const expectedAfterSecond =
    50_000_000 +
    (50_000_000 +
      firstExpectedValue +
      secondExpectedValue +
      fixedTransferFlowSats * 2) *
      (movementLiveFactor * 2) +
    fixedTransferFlowSats * 2;
  assert.ok(
    Math.abs(growthTotalAt(first.createdMs) - expectedAfterFirst) < 0.01,
    "Growth history must replay the first bond at its own H-1 oracle",
  );
  assert.ok(
    Math.abs(growthTotalAt(second.createdMs) - expectedAfterSecond) < 0.01,
    "Growth history must replay both bonds once at their separate H-1 oracles",
  );

  const wrongRecipientTransfer = {
    ...secondTransfer,
    recipientAddress: "1CQud1ZkoR4NSRJ2Lw31KssCpR4zSYMLJL",
  };
  const wrongBlockTransfer = {
    ...secondTransfer,
    blockHash: "f".repeat(64),
  };
  assert.equal(
    canonicalInceptionWorkMovementOracleByIdentity(
      [secondMint],
      [wrongRecipientTransfer],
    ).size,
    0,
  );
  assert.equal(
    canonicalInceptionWorkMovementOracleByIdentity(
      [secondMint],
      [wrongBlockTransfer],
    ).size,
    0,
  );
  const mismatchMetrics = creditNetworkValueMetrics({
    baseValueAt,
    cutoffMs: 300,
    includeEvents: true,
    tokenDefinitions: [
      {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    tokenMints: [secondMint],
    tokenTransfers: [wrongBlockTransfer],
  });
  assert.equal(
    mismatchMetrics.events[0].creditFloorAtConfirmModel,
    "canonical-frozen-credit-replay-v1",
  );
  assert.ok(
    Math.abs(
      mismatchMetrics.events[0].creditValueAtConfirmSats -
        secondExpectedValue,
    ) > 1,
    "a provenance mismatch must not inherit the Inception H-1 oracle",
  );
});

check("exact-tip WORK transfer projection preserves both Inception H-1 values", () => {
  const WORK_TOKEN_ID =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const WORK_TRANSFER_VALUE_PROJECTION_MODEL =
    "canonical-work-transfer-value-projection-v1";
  const numericFields = [
    "creditAmountMoved",
    "creditFloorAtConfirmSats",
    "creditLiveFloorSats",
    "creditLiveValueSats",
    "creditRevaluationFloorSats",
    "creditValueAtConfirmSats",
    "fixedEventFlowSats",
    "frozenNetworkValueSats",
    "liveNetworkValueBeforeEventSats",
    "liveNetworkValueSats",
    "networkValueBeforeEventSats",
  ];
  const projectedFields = [
    "amount",
    "amountAtoms",
    "confirmed",
    "creditFloorAtConfirmModel",
    "eventKeyVout",
    "recipientAddress",
    "senderAddress",
    "tokenId",
    "txid",
    "valueSnapshotBlockHash",
    "valueSnapshotBlockHeight",
    "valueSnapshotCanonicalSummaryHash",
    "valueSnapshotGeneratedAt",
    "valueSnapshotId",
    "creditFloorAtConfirmQ8",
    "creditLiveFloorQ8",
    "creditLiveValueQ8",
    "creditRevaluationFloorQ8",
    "creditValueAtConfirmQ8",
    "frozenNetworkValueQ8",
    "liveNetworkValueBeforeEventQ8",
    "liveNetworkValueQ8",
    "networkValueBeforeEventQ8",
    ...numericFields,
  ];
  const fromState = isolatedFunction(
    API_PATH,
    "canonicalWorkTransferValueProjectionFromState",
    {
      WORK_TOKEN_ID,
      WORK_TRANSFER_VALUE_PROJECTION_FIELD_NAMES: projectedFields,
      WORK_TRANSFER_VALUE_PROJECTION_MODEL,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      },
    },
  );
  const isUsable = isolatedFunction(
    API_PATH,
    "canonicalWorkTransferValueProjectionIsUsable",
    { WORK_TRANSFER_VALUE_PROJECTION_MODEL },
  );
  const mergeCreditNetworkValueRecord = isolatedFunction(
    API_PATH,
    "mergeCreditNetworkValueRecord",
    { CREDIT_NETWORK_VALUE_FIELD_NAMES: numericFields },
  );
  const transferHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenTransferHistoryItemKey",
    {
      numericValue: (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      },
    },
  );
  const mergeItems = (base, overlay, keyFor, merge) => {
    const byKey = new Map((base ?? []).map((item) => [keyFor(item), item]));
    for (const item of overlay ?? []) {
      const key = keyFor(item);
      byKey.set(key, merge(byKey.get(key), item));
    }
    return [...byKey.values()];
  };
  const apply = isolatedFunction(
    API_PATH,
    "tokenStateWithCanonicalWorkTransferValues",
    {
      canonicalWorkTransferValueProjectionIsUsable: isUsable,
      mergeTokenStateItemsByKey: mergeItems,
      mergeTokenTransferRecord: mergeCreditNetworkValueRecord,
      tokenStateWithPendingStats: (state) => state,
      tokenTransferHistoryItemKey: transferHistoryItemKey,
    },
  );
  const values = [
    {
      floor: 390.168909301053,
      frozen: 1_421_798_915.6275952,
      hash: "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
      height: 957_949,
      snapshotId: "first-h-minus-one-snapshot",
      txid: "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4",
      networkValueQ8: "819354709532211304",
    },
    {
      floor: 469.3981460001999,
      frozen: 1_710_515_007.9134884,
      hash: "00000000000000000000a9c98064bcf92b25b7c43576c8479befdcb17dfb85cd",
      height: 958_006,
      snapshotId: "second-h-minus-one-snapshot",
      txid: "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21",
      networkValueQ8: "985736106600419800",
    },
  ];
  const rawTransfers = values.map((value, index) => ({
    amount: 3_644_060,
    creditFloorAtConfirmSats: 0,
    creditValueAtConfirmSats: 0,
    eventKeyVout: index + 1,
    tokenId: WORK_TOKEN_ID,
    txid: value.txid,
  }));
  const valuedTransfers = values.map((value) => {
    const amountAtoms = parseWorkAmountToAtoms("3644060");
    const networkValueQ8 = BigInt(value.networkValueQ8);
    const creditFloorAtConfirmQ8 = networkValueQ8 / 21_000_000n;
    const creditValueAtConfirmQ8 =
      (BigInt(amountAtoms) * networkValueQ8) /
      (21_000_000n * WORK_UNIT_SCALE);
    const initialLiveFloorQ8 = decimalValueToQ8("344.16840058");
    const initialLiveValueQ8 =
      (BigInt(amountAtoms) * initialLiveFloorQ8) / WORK_UNIT_SCALE;
    return {
      ...rawTransfers.find((item) => item.txid === value.txid),
      amountAtoms,
      confirmed: true,
      creditAmountMoved: 3_644_060,
      creditFloorAtConfirmModel: "canonical-incb-h-minus-one-live-work-v1",
      creditFloorAtConfirmQ8: creditFloorAtConfirmQ8.toString(),
      creditFloorAtConfirmSats:
        q8ToCanonicalDecimal(creditFloorAtConfirmQ8),
      creditLiveFloorQ8: initialLiveFloorQ8.toString(),
      creditLiveFloorSats: q8ToCanonicalDecimal(initialLiveFloorQ8),
      creditLiveValueQ8: initialLiveValueQ8.toString(),
      creditLiveValueSats: q8ToCanonicalDecimal(initialLiveValueQ8),
      creditRevaluationFloorQ8: initialLiveFloorQ8.toString(),
      creditRevaluationFloorSats: q8ToCanonicalDecimal(initialLiveFloorQ8),
      creditValueAtConfirmQ8: creditValueAtConfirmQ8.toString(),
      creditValueAtConfirmSats:
        q8ToCanonicalDecimal(creditValueAtConfirmQ8),
      fixedEventFlowSats: 546,
      frozenNetworkValueQ8: (
        creditValueAtConfirmQ8 + 546n * VALUE_Q8_SCALE
      ).toString(),
      frozenNetworkValueSats: q8ToCanonicalDecimal(
        creditValueAtConfirmQ8 + 546n * VALUE_Q8_SCALE,
      ),
      liveNetworkValueBeforeEventQ8: networkValueQ8.toString(),
      liveNetworkValueBeforeEventSats:
        q8ToCanonicalDecimal(networkValueQ8),
      liveNetworkValueQ8: (
        initialLiveValueQ8 + 546n * VALUE_Q8_SCALE
      ).toString(),
      liveNetworkValueSats: q8ToCanonicalDecimal(
        initialLiveValueQ8 + 546n * VALUE_Q8_SCALE,
      ),
      networkValueBeforeEventQ8: networkValueQ8.toString(),
      networkValueBeforeEventSats: q8ToCanonicalDecimal(networkValueQ8),
      recipientAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
      senderAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
      valueSnapshotBlockHash: value.hash,
      valueSnapshotBlockHeight: value.height,
      valueSnapshotCanonicalSummaryHash: `${value.txid.slice(0, 63)}a`,
      valueSnapshotGeneratedAt: `2026-07-14T${value.height === 957_949 ? "03" : "06"}:00:00.000Z`,
      valueSnapshotId: value.snapshotId,
    };
  });
  const exactTipLiveFloorSats = 683.8074244507424;
  const exactTipLiveFloorQ8 = decimalValueToQ8(exactTipLiveFloorSats);
  const exactTipLiveFloorText = q8ToCanonicalDecimal(exactTipLiveFloorQ8);
  const projection = fromState(
    {
      mints: Array.from({ length: 100 }, (_, index) => ({ index })),
      transfers: [
        ...valuedTransfers,
        { ...valuedTransfers[0], confirmed: false, txid: "f".repeat(64) },
      ],
    },
    exactTipLiveFloorSats,
  );
  const projected = apply({ transfers: rawTransfers }, projection);

  assert.equal(projection.model, WORK_TRANSFER_VALUE_PROJECTION_MODEL);
  assert.equal(projection.items.length, 2, "only confirmed transfers are projected");
  for (const value of values) {
    const item = projected.transfers.find((row) => row.txid === value.txid);
    assert.equal(
      item.creditFloorAtConfirmSats,
      q8ToCanonicalDecimal(BigInt(value.networkValueQ8) / 21_000_000n),
    );
    assert.ok(Math.abs(Number(item.creditValueAtConfirmSats) - value.frozen) < 0.01);
    assert.equal(item.creditLiveFloorSats, exactTipLiveFloorText);
    assert.equal(item.creditLiveFloorQ8, exactTipLiveFloorQ8.toString());
    assert.equal(item.creditRevaluationFloorSats, exactTipLiveFloorText);
    assert.equal(
      item.creditRevaluationFloorQ8,
      exactTipLiveFloorQ8.toString(),
    );
    assert.ok(
      Math.abs(
        Number(item.creditLiveValueSats) -
          item.creditAmountMoved * Number(exactTipLiveFloorText),
      ) < 0.01,
    );
    assert.ok(
      Math.abs(
        Number(item.liveNetworkValueSats) -
          (Number(item.creditLiveValueSats) + 546),
      ) < 0.01,
    );
    assert.equal(item.valueSnapshotBlockHeight, value.height);
    assert.equal(item.valueSnapshotBlockHash, value.hash);
    assert.equal(item.valueSnapshotId, value.snapshotId);
  }
  const dd743 = projection.items.find(
    (item) => item.txid === values[0].txid,
  );
  const dd743FloorFirstQ8 =
    (BigInt(dd743.amountAtoms) * BigInt(dd743.creditFloorAtConfirmQ8)) /
    WORK_UNIT_SCALE;
  assert.equal(dd743.creditValueAtConfirmQ8, "142179891562759520");
  assert.equal(
    BigInt(dd743.creditValueAtConfirmQ8) - dd743FloorFirstQ8,
    383_720n,
    "dd743 must use its exact H-1 network value before dividing by WORK supply",
  );
  const unsafeAmount = "20999999.12345678";
  const unsafeAmountAtoms = parseWorkAmountToAtoms(unsafeAmount);
  const unsafeConfirmFloor = "400000000.12345678";
  const unsafeLiveFloor = "500000000.87654321";
  const unsafeConfirmFloorQ8 = decimalValueToQ8(unsafeConfirmFloor);
  const unsafeLiveFloorQ8 = decimalValueToQ8(unsafeLiveFloor);
  const unsafeNetworkValueBeforeEventQ8 =
    unsafeConfirmFloorQ8 * 21_000_000n + 12_345_678n;
  const unsafeConfirmValueQ8 =
    (BigInt(unsafeAmountAtoms) * unsafeNetworkValueBeforeEventQ8) /
    (21_000_000n * WORK_UNIT_SCALE);
  const unsafeFrozenValueQ8 =
    unsafeConfirmValueQ8 + 546n * VALUE_Q8_SCALE;
  const unsafeProjection = fromState(
    {
      transfers: [
        {
          amount: unsafeAmount,
          amountAtoms: unsafeAmountAtoms,
          confirmed: true,
          creditAmountMoved: Number(unsafeAmount),
          creditFloorAtConfirmModel: "canonical-work-live-floor-v1",
          creditFloorAtConfirmQ8: unsafeConfirmFloorQ8.toString(),
          creditFloorAtConfirmSats: unsafeConfirmFloor,
          creditValueAtConfirmQ8: unsafeConfirmValueQ8.toString(),
          creditValueAtConfirmSats:
            q8ToCanonicalDecimal(unsafeConfirmValueQ8),
          fixedEventFlowSats: 546,
          frozenNetworkValueQ8: unsafeFrozenValueQ8.toString(),
          frozenNetworkValueSats:
            q8ToCanonicalDecimal(unsafeFrozenValueQ8),
          liveNetworkValueBeforeEventQ8:
            unsafeNetworkValueBeforeEventQ8.toString(),
          liveNetworkValueBeforeEventSats:
            q8ToCanonicalDecimal(unsafeNetworkValueBeforeEventQ8),
          networkValueBeforeEventQ8:
            unsafeNetworkValueBeforeEventQ8.toString(),
          networkValueBeforeEventSats:
            q8ToCanonicalDecimal(unsafeNetworkValueBeforeEventQ8),
          tokenId: WORK_TOKEN_ID,
          txid: "9".repeat(64),
        },
      ],
    },
    unsafeLiveFloor,
  );
  const unsafeItem = unsafeProjection.items[0];
  const unsafeLiveValueQ8 =
    (BigInt(unsafeAmountAtoms) * unsafeLiveFloorQ8) / WORK_UNIT_SCALE;
  assert.ok(
    unsafeLiveValueQ8 / VALUE_Q8_SCALE > BigInt(Number.MAX_SAFE_INTEGER),
  );
  assert.equal(unsafeItem.creditLiveValueQ8, unsafeLiveValueQ8.toString());
  assert.equal(
    unsafeItem.creditLiveValueSats,
    q8ToCanonicalDecimal(unsafeLiveValueQ8),
  );
  assert.equal(
    unsafeItem.liveNetworkValueQ8,
    (unsafeLiveValueQ8 + 546n * VALUE_Q8_SCALE).toString(),
    "WORK transfer live value above 2^53 must stay exact Q8 text",
  );
  const absentTxid = "e".repeat(64);
  const projectedWithoutAddition = apply(
    { transfers: rawTransfers },
    {
      ...projection,
      items: [
        ...projection.items,
        {
          ...projection.items[0],
          eventKeyVout: 99,
          txid: absentTxid,
        },
      ],
    },
  );
  assert.equal(projectedWithoutAddition.transfers.length, rawTransfers.length);
  assert.equal(
    projectedWithoutAddition.transfers.some(
      (item) => item.txid === absentTxid,
    ),
    false,
    "a valuation projection cannot create a transfer absent from the indexed page",
  );

  const matches = isolatedFunction(
    API_PATH,
    "canonicalWorkTransferValueSummaryMatchesPayload",
    {
      canonicalWorkTransferValueProjectionIsUsable: isUsable,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock),
    },
  );
  const blockHash = "b".repeat(64);
  const summary = {
    indexedThroughBlock: 958_016,
    indexedThroughBlockHash: blockHash,
    snapshotId: "exact-tip-snapshot",
    workTransferValueProjection: projection,
  };
  const gate = {
    canonicalHash: blockHash,
    indexedThroughBlock: 958_016,
    ready: true,
    storedHash: blockHash,
    summarySnapshot: { snapshotId: "exact-tip-snapshot" },
    summarySnapshotOk: true,
    tipHeight: 958_016,
  };
  assert.equal(matches(summary, { indexedThroughBlock: 958_016 }, gate), true);
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_015 }, gate),
    false,
    "a mixed-height token page cannot receive the projection",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      canonicalHash: "c".repeat(64),
    }),
    false,
    "a hash mismatch must fail closed",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      storedHash: "d".repeat(64),
    }),
    false,
    "a stored checkpoint hash mismatch must fail closed",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      summarySnapshotOk: false,
    }),
    false,
    "an ineligible database summary must fail closed",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      summarySnapshot: { snapshotId: "different-snapshot" },
    }),
    false,
    "a different eligible database summary cannot lend its gate to the projection",
  );
});

check("growth chart replay is linear and matches exact credit valuation", () => {
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const baseValueProvider = () => (atMs) =>
    1_000 + Math.max(0, Math.floor(Number(atMs) / 100)) * 100;
  const compareCreditValueReplayEvents = (left, right) =>
    left.createdMs - right.createdMs ||
    left.order - right.order ||
    String(left.txid ?? "").localeCompare(String(right.txid ?? ""));
  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const creditMovementIdentity = isolatedFunction(
    API_PATH,
    "creditMovementIdentity",
    { numericValue },
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const globals = {
    CREDIT_MINER_FEE_ACCOUNTING_MODEL:
      "canonical-unique-tx-input-output-v1",
    TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
      "token-listing",
      "token-listing-sealed",
      "token-listing-closed",
    ]),
    TOKEN_MIN_MUTATION_PRICE_SATS: 546,
    canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
    compareCreditValueReplayEvents,
    canonicalReplayPrefixLengthAtMs,
    canonicalReplayTimeline,
    creditMovementIdentity,
    creditReplayTransactionMinerFeeSats,
    creditValueEventHeight: () => Number.MAX_SAFE_INTEGER,
    creditValueEventIndex: () => Number.MAX_SAFE_INTEGER,
    creditValueEventMs: (item) => Number(item?.createdMs),
    growthActualBaseNetworkValueBeforeCanonicalItemProvider:
      (_collections, provider) =>
      (_source, createdMs) =>
        provider(createdMs - 1),
    growthActualBaseNetworkValueAtProvider: baseValueProvider,
    isTokenActivityItem: (item) => String(item?.kind ?? "").startsWith("token-"),
    numericValue,
    tokenCanUseCreditNetworkFloor: () => true,
    verifiedCanonicalMinerFeeCoverage: isolatedFunction(
      API_PATH,
      "verifiedCanonicalMinerFeeCoverage",
    ),
  };
  const fastProvider = isolatedFunction(
    API_PATH,
    "growthActualLiveTotalSatsAtProvider",
    globals,
  );
  const exactMetrics = isolatedFunction(
    API_PATH,
    "creditNetworkValueMetrics",
    globals,
  );
  const tokenId = "a".repeat(64);
  const tokenDefinitions = [
    { maxSupply: 1_000, ticker: "FAST", tokenId },
  ];
  const row = (kind, txid, createdMs, extra = {}) => ({
    confirmed: true,
    createdMs,
    kind,
    tokenId,
    txid,
    ...extra,
  });
  const idActivity = [
    row("token-create", "1".repeat(64), 50, {
      amountSats: 546,
      minerFeeSats: 10,
      proofPaymentSats: 546,
    }),
    row("token-mint", "2".repeat(64), 100, { minerFeeSats: 30 }),
    row("token-listing", "3".repeat(64), 150, {
      marketplaceMutationFeeSats: 546,
      minerFeeSats: 20,
    }),
    row("token-transfer", "4".repeat(64), 200, { minerFeeSats: 40 }),
    row("token-sale", "5".repeat(64), 300, { minerFeeSats: 50 }),
  ];
  const tokenMints = [
    row("mint", "2".repeat(64), 100, { amount: 100, paidSats: 1_000 }),
  ];
  const tokenTransfers = [
    row("transfer", "4".repeat(64), 200, { amount: 20, paidSats: 546 }),
  ];
  const tokenSales = [
    row("sale", "5".repeat(64), 300, {
      amount: 10,
      marketplaceMutationFeeSats: 600,
      priceSats: 5_000,
    }),
  ];
  const at = fastProvider(
    [],
    idActivity,
    [],
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  );
  const expectedAt = (cutoffMs) => {
    const baseValueAt = baseValueProvider();
    const base = baseValueAt(cutoffMs);
    const credit = exactMetrics({
      baseValueAt,
      confirmedActivity: idActivity,
      cutoffMs,
      tokenDefinitions,
      tokenMints,
      tokenSales,
      tokenTransfers,
    });
    return base + credit.creditEventLiveValueSats;
  };
  for (const cutoffMs of [0, 50, 100, 150, 200, 300, 400]) {
    assert.ok(
      Math.abs(at(cutoffMs) - expectedAt(cutoffMs)) < 1e-9,
      `linear chart value diverged at ${cutoffMs}`,
    );
  }
  assert.ok(
    Math.abs(at(100) - expectedAt(100)) < 1e-9,
    "linear chart replay did not reset for an earlier cutoff",
  );
});

check("canonical credit base lookup is hash exact and preserves nonlinear state", () => {
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const blockHash = "a".repeat(64);
  const otherBlockHash = "b".repeat(64);
  const targetTxid = "f".repeat(64);
  const emptyGrowthActualBaseState = () => ({ flowSats: 0, powids: 0 });
  const growthActualBaseStateApplyContribution = (
    state,
    contribution,
    multiplier = 1,
  ) => {
    state[contribution.field] += contribution.value * multiplier;
    return state;
  };
  const growthActualBaseStateAdd = (state, addition, multiplier = 1) => {
    state.flowSats += numericValue(addition?.flowSats) * multiplier;
    state.powids += numericValue(addition?.powids) * multiplier;
    return state;
  };
  const growthActualBaseStateTotalSats = (state) =>
    state.powids ** 2 * 10 + state.flowSats;
  const growthActualBaseStateTotalQ8 = (state) =>
    BigInt(growthActualBaseStateTotalSats(state)) * VALUE_Q8_SCALE;
  const growthActualBaseNetworkValueEvents = (
    records,
    idActivity,
    sales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  ) => [
    ...(Array.isArray(records) ? records : []).map((source) => ({
      source,
      contribution: { field: "powids", value: 1 },
    })),
    ...[
      idActivity,
      sales,
      tokenDefinitions,
      tokenMints,
      tokenTransfers,
      tokenSales,
    ]
      .flatMap((items) => (Array.isArray(items) ? items : []))
      .map((source) => ({
        source,
        contribution: { field: "flowSats", value: numericValue(source.value) },
      })),
  ]
    .filter(
      ({ source }) =>
        source?.confirmed === true &&
        Number.isFinite(Date.parse(source?.createdAt ?? "")),
    )
    .map(({ source, contribution }) => ({
      blockHash: String(source.blockHash ?? "").trim().toLowerCase(),
      blockHeight: Number(source.blockHeight),
      blockIndex: Number(source.blockIndex),
      contribution,
      createdMs: Date.parse(source.createdAt),
      source,
      txid: String(source.txid ?? "").trim().toLowerCase(),
    }));
  const prefixProviderFactory = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueBeforeCanonicalItemProvider",
    {
      emptyGrowthActualBaseState,
      growthActualBaseNetworkValueEvents,
      growthActualBaseStateAdd,
      growthActualBaseStateApplyContribution,
      growthActualBaseStateTotalQ8,
      growthActualBaseStateTotalSats,
      numericValue,
    },
  );
  const item = (value, blockHeight, blockIndex, createdAt, extra = {}) => ({
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt,
    network: "livenet",
    txid: String(value).padStart(64, "0"),
    value,
    ...extra,
  });
  const emptyCollections = () => ({
    idActivity: [],
    records: [],
    sales: [],
    tokenDefinitions: [],
    tokenMints: [],
    tokenSales: [],
    tokenTransfers: [],
  });
  const collections = emptyCollections();
  const sharedEarlierTxid = "1".repeat(64);
  collections.records = [
    item(101, 99, 1, "2035-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
      txid: sharedEarlierTxid,
    }),
    item(102, 100, 1, "2030-01-01T00:00:00.000Z"),
    item(103, 100, 2, "1990-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
    }),
    item(104, 100, 3, "2020-01-01T00:00:00.000Z", {
      blockHash: "",
    }),
  ];
  collections.idActivity = [
    item(2, 99, 2, "2036-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
      txid: sharedEarlierTxid,
    }),
    item(3, 100, 1, "2030-01-01T00:00:00.000Z"),
    item(5, 100, 2, "1990-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
    }),
    item(7, 100, 3, "2020-01-01T00:00:00.000Z", {
      blockHash: "",
    }),
    item(13, 100, 4, "not-a-date"),
    item(11, 100, 6, "2010-01-01T00:00:00.000Z"),
  ];
  const timestampProvider = () => 999;
  const diagnostics = {};
  const before = prefixProviderFactory(
    collections,
    timestampProvider,
    diagnostics,
  );
  const source = (blockHeight, blockIndex, extra = {}) => ({
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt: "2000-01-01T00:00:00.000Z",
    network: "livenet",
    txid: targetTxid,
    ...extra,
  });

  const exactBefore = (target) => {
    const targetHeight = Number(target.blockHeight);
    const targetIndex = Number(target.blockIndex);
    const targetHash = String(target.blockHash ?? "").trim().toLowerCase();
    const targetTxid = String(target.txid ?? "").trim().toLowerCase();
    const exactHash = /^[0-9a-f]{64}$/u.test(targetHash);
    const state = emptyGrowthActualBaseState();
    for (const event of growthActualBaseNetworkValueEvents(
      collections.records,
      collections.idActivity,
      collections.sales,
      collections.tokenDefinitions,
      collections.tokenMints,
      collections.tokenTransfers,
      collections.tokenSales,
    )) {
      const precedes =
        event.blockHeight < targetHeight ||
        (event.blockHeight === targetHeight &&
          event.blockIndex < targetIndex &&
          (!exactHash || event.blockHash === targetHash));
      if (
        precedes &&
        !(event.txid && event.txid === targetTxid)
      ) {
        growthActualBaseStateApplyContribution(state, event.contribution);
      }
    }
    return growthActualBaseStateTotalSats(state);
  };
  const exactSource = source(100, 5);
  const hashlessSource = source(100, 5, { blockHash: "" });
  const nextHeightSource = source(101, 0);
  const sameTxSource = source(100, 5, { txid: sharedEarlierTxid });
  for (const target of [
    exactSource,
    hashlessSource,
    nextHeightSource,
    sameTxSource,
  ]) {
    assert.equal(before(target, Date.now()), exactBefore(target));
  }
  assert.equal(before(exactSource, Date.now()), 45);
  assert.equal(before(hashlessSource, Date.now()), 177);
  assert.equal(before(nextHeightSource, Date.now()), 188);
  assert.equal(before(sameTxSource, Date.now()), 13);
  for (let index = 0; index < 1_000; index += 1) {
    assert.equal(before(exactSource, Date.now()), exactBefore(exactSource));
  }
  assert.equal(
    diagnostics.invalidCreatedAtRows,
    1,
    "invalid timestamps must be explicitly observed and excluded like the exact scan",
  );
  assert.equal(diagnostics.providerBuilds, 1);
  assert.equal(diagnostics.slowFallbacks, 0);
  assert.equal(diagnostics.blockHashFallbacks, 0);
  assert.equal(diagnostics.sameTxFallbacks, 0);
  assert.equal(diagnostics.sameTxAdjustments, 4);
  assert.equal(diagnostics.prefixLookups, 1_008);
  assert.ok(
    diagnostics.cursorResets <= 3,
    "canonical lookups must reset only when the requested position regresses",
  );
});

check("an accepted ID buy projects the buyer as the current owner", async () => {
  const txid = "9".repeat(64);
  const listingId = "a".repeat(64);
  const buyer = "bc1buyer";
  const idVerifierItemsFromState = isolatedFunction(
    API_PATH,
    "idVerifierItemsFromState",
  );
  const [buy] = idVerifierItemsFromState(
    {
      activity: [
        {
          confirmed: true,
          id: "fixture-id",
          kind: "id-buy",
          listingId,
          txid,
        },
      ],
      listings: [],
      sales: [
        {
          buyerAddress: buyer,
          id: "fixture-id",
          receiveAddress: buyer,
          sellerAddress: "bc1seller",
          txid,
        },
      ],
    },
    txid,
  );
  assert.equal(buy.ownerAddress, buyer);

  const upsertProjection = isolatedFunction(BACKFILL_PATH, "upsertProjection", {
    INFINITY_BOND_KIND: "infinity-bond",
    NETWORK: "livenet",
    bondTagForKind: () => null,
    eventKind: (item) => item.kind,
    numberOrNull: (value) => (Number.isFinite(Number(value)) ? Number(value) : null),
  });
  const calls = [];
  await upsertProjection(
    {
      async query(sql, params) {
        calls.push({ params, sql: String(sql) });
        return { rows: [] };
      },
    },
    "id-sales",
    { ...buy, blockHeight: 101 },
    "confirmed",
  );
  const update = calls.find((call) => /UPDATE proof_indexer\.id_records/u.test(call.sql));
  assert.ok(update, "ID buy did not update the current ID record");
  assert.equal(update.params[2], buyer);
  assert.equal(update.params[3], buyer);
  assert.equal(update.params[5], txid);
});

check("credit-unit storage drops the 78-digit ceiling exactly once", async () => {
  const schemaSource = fileSource(SCHEMA_PATH);
  const backfillSource = fileSource(BACKFILL_PATH);
  for (const declaration of [
    /max_supply\s+numeric\s+NOT NULL/u,
    /mint_amount\s+numeric\s+NOT NULL/u,
    /confirmed_balance\s+numeric\s+NOT NULL/u,
    /pending_delta\s+numeric\s+NOT NULL/u,
    /amount\s+numeric\s+NOT NULL/u,
  ]) {
    assert.match(schemaSource, declaration);
  }
  assert.doesNotMatch(
    schemaSource,
    /(?:max_supply|mint_amount|confirmed_balance|pending_delta|amount)\s+numeric\(78\s*,\s*0\)/u,
  );
  assert.doesNotMatch(backfillSource, /::numeric\(78\s*,\s*0\)/u);
  assert.doesNotMatch(backfillSource, /["']9["']\.repeat\(78\)/u);
  assert.match(
    schemaSource,
    /BOND|Synthetic bond definitions are uncapped by protocol/u,
  );
  for (const constraint of [
    "credit_definitions_max_supply_integer",
    "credit_definitions_mint_amount_integer",
    "credit_balances_confirmed_balance_integer",
    "credit_balances_pending_delta_integer",
    "credit_listings_amount_integer",
  ]) {
    assert.ok(schemaSource.includes(constraint));
  }

  const migrateUnboundedCreditUnitStorage = isolatedFunction(
    BACKFILL_PATH,
    "migrateUnboundedCreditUnitStorage",
    {
      BOND_UNCAPPED_MAX_SUPPLY_STORAGE: "0",
      INCB_TOKEN_ID,
      NETWORK: "livenet",
      POWB_TOKEN_ID,
    },
  );
  const columns = new Map([
    ["credit_definitions.max_supply", 5111812],
    ["credit_definitions.mint_amount", 5111812],
    ["credit_balances.confirmed_balance", 5111812],
    ["credit_balances.pending_delta", 5111812],
    ["credit_listings.amount", 5111812],
  ]);
  const constraints = new Map();
  const bonds = new Map([
    [
      POWB_TOKEN_ID,
      {
        max_supply: "9".repeat(78),
        metadata: {
          maxSupply: null,
          maxSupplyModel: "uncapped",
          maxSupplyStorage: "9".repeat(78),
          uncapped: true,
        },
      },
    ],
    [
      INCB_TOKEN_ID,
      {
        max_supply: "9".repeat(78),
        metadata: {
          maxSupply: null,
          maxSupplyModel: "uncapped",
          maxSupplyStorage: "9".repeat(78),
          uncapped: true,
        },
      },
    ],
  ]);
  const calls = [];
  const client = {
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (/FROM pg_attribute a/u.test(text)) {
        return {
          rows: [...columns].map(([key, atttypmod]) => {
            const [table_name, column_name] = key.split(".");
            return {
              atttypmod,
              column_name,
              formatted_type:
                atttypmod === -1 ? "numeric" : "numeric(78,0)",
              table_name,
            };
          }),
        };
      }
      const alteredTable = /ALTER TABLE proof_indexer\.(credit_(?:definitions|balances|listings))[\s\S]*ALTER COLUMN/u.exec(
        text,
      )?.[1];
      if (alteredTable) {
        for (const key of columns.keys()) {
          if (key.startsWith(`${alteredTable}.`)) columns.set(key, -1);
        }
        return { rowCount: 0, rows: [] };
      }
      if (/SELECT c\.relname AS table_name, p\.conname/u.test(text)) {
        return {
          rows: [...constraints].map(([conname, convalidated]) => ({
            conname,
            convalidated,
          })),
        };
      }
      const added = /ADD CONSTRAINT ([a-z_]+)/u.exec(text)?.[1];
      if (added) {
        constraints.set(added, false);
        return { rowCount: 0, rows: [] };
      }
      const validated = /VALIDATE CONSTRAINT ([a-z_]+)/u.exec(text)?.[1];
      if (validated) {
        constraints.set(validated, true);
        return { rowCount: 0, rows: [] };
      }
      if (/UPDATE proof_indexer\.credit_definitions/u.test(text)) {
        let rowCount = 0;
        for (const bond of bonds.values()) {
          if (
            bond.max_supply !== "0" ||
            Object.hasOwn(bond.metadata, "maxSupplyStorage")
          ) {
            rowCount += 1;
            bond.max_supply = "0";
            bond.metadata = {
              maxSupply: null,
              maxSupplyModel: "uncapped",
              uncapped: true,
            };
          }
        }
        return { rowCount, rows: [] };
      }
      if (/SELECT p\.conname, p\.convalidated/u.test(text)) {
        return {
          rows: [...constraints].map(([conname, convalidated]) => ({
            conname,
            convalidated,
          })),
        };
      }
      if (/SELECT token_id, max_supply::text AS max_supply/u.test(text)) {
        return {
          rows: [...bonds].map(([token_id, bond]) => ({ token_id, ...bond })),
        };
      }
      throw new Error(`Unexpected migration query: ${text}`);
    },
  };

  const first = await migrateUnboundedCreditUnitStorage(client);
  assert.deepEqual([...first.alteredColumns], [...columns.keys()].sort());
  assert.equal(first.addedConstraints.length, 5);
  assert.equal(first.normalizedBondDefinitions, 2);
  assert.equal(first.storageModel, "unconstrained-integer-numeric-v1");
  assert.ok([...columns.values()].every((typmod) => typmod === -1));
  assert.ok([...constraints.values()].every(Boolean));
  assert.ok([...bonds.values()].every((bond) => bond.max_supply === "0"));

  const firstCallCount = calls.length;
  const second = await migrateUnboundedCreditUnitStorage(client);
  assert.deepEqual([...second.alteredColumns], []);
  assert.deepEqual([...second.addedConstraints], []);
  assert.equal(second.normalizedBondDefinitions, 0);
  assert.equal(
    calls.slice(firstCallCount).filter((sql) =>
      /ALTER COLUMN [a-z_]+ TYPE numeric/u.test(sql)
    ).length,
    0,
    "idempotent migration reacquired a typmod-alter lock",
  );
});

let failures = 0;
for (const test of tests) {
  try {
    await test.run();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${test.name}`);
    console.error(`  ${error?.stack ?? error}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} behavior checks passed.`);
if (failures > 0) {
  process.exitCode = 1;
}
