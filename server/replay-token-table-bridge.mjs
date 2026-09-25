import { WORK_AMO_V8_AUTH_VERSION } from "./work-amo-v8.mjs";
import {
  isLegacyWorkMarketListing,
  WORK_MARKET_V2_ACTIVATION_HEIGHT,
  WORK_MARKET_V2_DECLARATION_TXID,
  workMarketV1RefundSnapshotEvidence,
} from "./work-market-v2.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
  formatWorkAtoms,
  normalizeWorkAtoms,
  normalizeWorkSubatoms,
  workSubatomsToLegacyAtoms,
} from "./work-units.mjs";

const REPLAY_FROM_HEIGHT = 958_383;
const TXID = /^[0-9a-f]{64}$/u;

const workItems = (items) =>
  (Array.isArray(items) ? items : []).filter(
    (item) => String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID,
  );

const exactHash = (value) => String(value ?? "").trim().toLowerCase();

// This admits only the current, bound PWT range replay. A historical witness
// binding alone is never authority to bypass the ordinary precision reader.
export function activeReplayTokenTableBridgeEra({
  activationHeight,
  currentBindingMatches,
  exactCheckpointHash,
  exactCheckpointHeight,
  network,
  rebuild,
  replayState,
}) {
  const height = Number(exactCheckpointHeight);
  const activation = Number(activationHeight);
  const hash = exactHash(exactCheckpointHash);
  if (
    network !== "livenet" ||
    replayState !== "active" ||
    currentBindingMatches !== true ||
    rebuild?.network !== "livenet" ||
    rebuild?.mode !== "pwt-range-replay" ||
    rebuild?.status !== "active" ||
    rebuild?.active !== true ||
    rebuild?.complete !== false ||
    Number(rebuild?.rangeReplayFromHeight) !== REPLAY_FROM_HEIGHT ||
    !Number.isSafeInteger(height) ||
    height < REPLAY_FROM_HEIGHT - 1 ||
    !Number.isSafeInteger(activation) ||
    activation <= REPLAY_FROM_HEIGHT ||
    !TXID.test(hash) ||
    Number(rebuild?.indexedThroughBlock) !== height ||
    exactHash(rebuild?.indexedThroughBlockHash) !== hash
  ) {
    return "";
  }
  return height < activation
    ? WORK_ATOMIC_PROJECTION_MODEL
    : WORK_SUBATOM_PROJECTION_MODEL;
}

function canonicalUnits(value, model, { signed = false, zero = false } = {}) {
  try {
    const options = { allowNegative: signed, allowZero: zero };
    return BigInt(
      model === WORK_SUBATOM_PROJECTION_MODEL
        ? normalizeWorkSubatoms(value, options)
        : normalizeWorkAtoms(value, options),
    );
  } catch {
    return null;
  }
}

function movementUnits(item, model) {
  if (item?.amountStorageModel !== model) return null;
  return canonicalUnits(
    model === WORK_SUBATOM_PROJECTION_MODEL
      ? item.amountSubatoms
      : item.amountAtoms,
    model,
  );
}

function tableMintSubatoms(item) {
  if (item?.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL) {
    return movementUnits(item, WORK_SUBATOM_PROJECTION_MODEL);
  }
  const atoms = movementUnits(item, WORK_ATOMIC_PROJECTION_MODEL);
  return atoms === null ? null : atoms * WORK_SUBATOM_CONVERSION_FACTOR;
}

function tableWorkMovementUnits(item, model) {
  const hasAtoms = item?.amountAtoms !== undefined &&
    item?.amountAtoms !== null && item?.amountAtoms !== "";
  const hasSubatoms = item?.amountSubatoms !== undefined &&
    item?.amountSubatoms !== null && item?.amountSubatoms !== "";
  if (item?.amountStorageModel === WORK_ATOMIC_PROJECTION_MODEL) {
    return model === WORK_ATOMIC_PROJECTION_MODEL && !hasSubatoms
      ? movementUnits(item, WORK_ATOMIC_PROJECTION_MODEL)
      : null;
  }
  if (item?.amountStorageModel !== WORK_SUBATOM_PROJECTION_MODEL || hasAtoms) {
    return null;
  }
  const subatoms = movementUnits(item, WORK_SUBATOM_PROJECTION_MODEL);
  const factor = model === WORK_ATOMIC_PROJECTION_MODEL
    ? WORK_SUBATOM_CONVERSION_FACTOR
    : 1n;
  return subatoms !== null && subatoms % factor === 0n
    ? subatoms / factor
    : null;
}

function mintIdentity(item, units) {
  const txid = exactHash(item?.txid);
  const minter = String(item?.minterAddress ?? "").trim();
  return TXID.test(txid) && minter && units !== null
    ? `${txid}:${minter}:${units}`
    : "";
}

function addBalance(balances, addressValue, change) {
  const address = String(addressValue ?? "").trim();
  if (!address || change === null) return false;
  balances.set(address, (balances.get(address) ?? 0n) + change);
  return true;
}

function historicalWorkBalances(state, model) {
  const balances = new Map();
  const mintIdentities = [];
  let supply = 0n;
  for (const mint of workItems(state?.mints)) {
    if (mint?.confirmed !== true) return null;
    const amount = movementUnits(mint, model);
    const identity = mintIdentity(mint, amount);
    if (!identity || !addBalance(balances, mint.minterAddress, amount)) {
      return null;
    }
    mintIdentities.push(identity);
    supply += amount;
  }
  if (mintIdentities.length === 0) return null;
  for (const [items, senderKey, recipientKey] of [
    [state?.transfers, "senderAddress", "recipientAddress"],
    [state?.sales, "sellerAddress", "buyerAddress"],
  ]) {
    for (const item of workItems(items)) {
      if (item?.confirmed !== true) return null;
      const amount = movementUnits(item, model);
      if (
        amount === null ||
        !addBalance(balances, item[senderKey], -amount) ||
        !addBalance(balances, item[recipientKey], amount)
      ) {
        return null;
      }
    }
  }
  for (const [address, balance] of balances) {
    if (balance < 0n) return null;
    if (balance === 0n) balances.delete(address);
  }
  return { balances, mintIdentities: mintIdentities.sort(), supply };
}

function exactPositionInteger(value, minimum) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum
    ? number
    : null;
}

function exactQ8WorkMovementPosition(item, checkpointHeight) {
  const blockHash = exactHash(item?.blockHash);
  const blockHeight = exactPositionInteger(item?.blockHeight, 1);
  const blockIndex = exactPositionInteger(item?.blockIndex, 0);
  const protocolVout = exactPositionInteger(item?.protocolVout, 0);
  const recordOrdinal = exactPositionInteger(item?.recordOrdinal, 0);
  return TXID.test(blockHash) &&
    blockHeight !== null && blockHeight <= checkpointHeight &&
    blockIndex !== null && protocolVout !== null &&
    recordOrdinal !== null
    ? { blockHash, blockHeight, blockIndex, protocolVout, recordOrdinal }
    : null;
}

function matchingQ8MovementValuationMetadata(current, original, kind) {
  const integerFields = kind === "sales"
    ? ["priceSats", "paidSats"]
    : ["paidSats"];
  for (const field of integerFields) {
    const currentValue = exactPositionInteger(current?.[field], 0);
    const originalValue = exactPositionInteger(original?.[field], 0);
    if (
      currentValue !== null && originalValue !== null &&
      currentValue !== originalValue
    ) {
      return false;
    }
  }
  const currentAt = Date.parse(current?.createdAt ?? "");
  const originalAt = Date.parse(original?.createdAt ?? "");
  return !Number.isFinite(currentAt) || !Number.isFinite(originalAt) ||
    currentAt === originalAt;
}

// Current relational movements are witnesses only. The bounded PWT events
// remain the source of the historical movement and its valuation fields.
function exactQ8WorkMovements(table, historical, checkpointHeight) {
  for (const [kind, addressFields] of [
    ["sales", ["sellerAddress", "buyerAddress", "listingId"]],
    ["transfers", ["senderAddress", "recipientAddress"]],
  ]) {
    const originals = workItems(historical?.[kind]);
    const current = workItems(table?.[kind]);
    if (originals.length !== current.length) return false;
    const originalByTxid = new Map();
    for (const item of originals) {
      const txid = exactHash(item?.txid);
      const position = exactQ8WorkMovementPosition(item, checkpointHeight);
      if (
        item?.confirmed !== true || !TXID.test(txid) ||
        originalByTxid.has(txid) || !position ||
        movementUnits(item, WORK_ATOMIC_PROJECTION_MODEL) === null
      ) {
        return false;
      }
      originalByTxid.set(txid, { item, position });
    }
    const seen = new Set();
    for (const item of current) {
      const txid = exactHash(item?.txid);
      const original = originalByTxid.get(txid);
      const position = exactQ8WorkMovementPosition(item, checkpointHeight);
      const amount = tableWorkMovementUnits(
        item,
        WORK_ATOMIC_PROJECTION_MODEL,
      );
      if (
        item?.confirmed !== true || !original || seen.has(txid) ||
        !position || amount === null ||
        amount !== movementUnits(
          original.item,
          WORK_ATOMIC_PROJECTION_MODEL,
        ) ||
        Object.keys(position).some((field) =>
          position[field] !== original.position[field]
        ) ||
        !matchingQ8MovementValuationMetadata(item, original.item, kind) ||
        addressFields.some((field) =>
          (field === "listingId"
            ? exactHash(item?.[field]) !== exactHash(original.item?.[field])
            : String(item?.[field] ?? "").trim() !==
              String(original.item?.[field] ?? "").trim())
        )
      ) {
        return false;
      }
      seen.add(txid);
    }
    if (seen.size !== originals.length) return false;
  }
  return true;
}

function originalListingPosition(current, original, matchedSaleTxid, closed) {
  const listingId = exactHash(current?.listingId);
  if (
    !TXID.test(listingId) ||
    exactHash(current?.txid) !== listingId ||
    exactHash(original?.listingId) !== listingId ||
    exactHash(original?.txid) !== listingId ||
    current?.confirmed !== true ||
    original?.confirmed !== true
  ) {
    return null;
  }
  const fields = [
    "blockHash",
    "blockHeight",
    "blockIndex",
    "protocolVout",
    "recordOrdinal",
  ];
  const originalHash = exactHash(original?.blockHash);
  const originalIntegers = [
    ["blockHeight", 1],
    ["blockIndex", 0],
    ["protocolVout", 0],
    ["recordOrdinal", 0],
  ];
  if (
    !TXID.test(originalHash) ||
    originalIntegers.some(([key, minimum]) =>
      exactPositionInteger(original?.[key], minimum) === null
    )
  ) {
    return null;
  }
  const closedTxid = exactHash(current?.closedTxid);
  const saleTxid = exactHash(matchedSaleTxid);
  const saleBacked = TXID.test(saleTxid);
  const exactClose =
    current?.closedConfirmed === true &&
    TXID.test(closedTxid) &&
    (saleBacked
      ? ["closed", "sold"].includes(current?.status) &&
        closedTxid === saleTxid
      : ["closed", "delisted"].includes(current?.status) &&
        current?.closedByCanonicalOutpointSpend === true);
  if (
    (closed && !exactClose) ||
    (!closed && (
      saleBacked ||
      current?.closedConfirmed === true ||
      TXID.test(closedTxid)
    ))
  ) {
    return null;
  }
  const missing = fields.filter((key) =>
    current?.[key] === undefined ||
    current?.[key] === null ||
    current?.[key] === ""
  );
  if (missing.length === fields.length) {
    // The relational sale-close projection omits the original opening
    // position. Only an exact matched sale may supply it from its original
    // canonical listing event; every other missing or partial tuple fails.
    return closed &&
      saleBacked &&
      closedTxid === saleTxid
      ? Object.fromEntries(fields.map((key) => [key, original[key]]))
      : null;
  }
  if (missing.length > 0 || exactHash(current?.blockHash) !== originalHash) {
    return null;
  }
  if (
    originalIntegers.some(([key, minimum]) =>
      exactPositionInteger(current?.[key], minimum) !==
        exactPositionInteger(original?.[key], minimum)
    )
  ) {
    return null;
  }
  return {};
}

function exactWorkSalesByListingId(table, historical, model) {
  const originalSales = workItems(historical?.sales);
  const currentSales = workItems(table?.sales);
  const saleKey = (sale) => {
    const txid = exactHash(sale?.txid);
    const listingId = exactHash(sale?.listingId);
    return TXID.test(txid) && TXID.test(listingId)
      ? txid + ":" + listingId
      : "";
  };
  const originalSalesByKey = new Map();
  for (const sale of originalSales) {
    const key = saleKey(sale);
    if (!key || originalSalesByKey.has(key)) return null;
    originalSalesByKey.set(key, sale);
  }
  const matchedSaleByListingId = new Map();
  for (const sale of currentSales) {
    const key = saleKey(sale);
    const original = originalSalesByKey.get(key);
    const listingId = exactHash(sale?.listingId);
    if (
      !key ||
      matchedSaleByListingId.has(listingId) ||
      !original ||
      sale?.confirmed !== true ||
      original?.confirmed !== true ||
      String(sale?.sellerAddress ?? "").trim() !==
        String(original?.sellerAddress ?? "").trim() ||
      String(sale?.buyerAddress ?? "").trim() !==
        String(original?.buyerAddress ?? "").trim() ||
      tableWorkMovementUnits(sale, model) !==
        movementUnits(original, model) ||
      !TXID.test(exactHash(sale?.blockHash)) ||
      exactHash(sale?.blockHash) !== exactHash(original?.blockHash) ||
      exactPositionInteger(sale?.blockHeight, 1) === null ||
      exactPositionInteger(sale?.blockHeight, 1) !==
        exactPositionInteger(original?.blockHeight, 1) ||
      exactPositionInteger(sale?.blockIndex, 0) === null ||
      exactPositionInteger(sale?.blockIndex, 0) !==
        exactPositionInteger(original?.blockIndex, 0)
    ) {
      return null;
    }
    matchedSaleByListingId.set(listingId, exactHash(sale.txid));
  }
  if (
    currentSales.length !== originalSalesByKey.size ||
    matchedSaleByListingId.size !== currentSales.length
  ) {
    return null;
  }
  return matchedSaleByListingId;
}

// The physical reader applies the pinned V2 refund cutover to legacy rows at
// the current tip. Undo only that policy label for the bounded activity check;
// the canonical summary reapplies the cutover after this bridge. An actual
// outpoint spend still needs its complete independently checked close proof.
function rawLegacyV2CutoverListing(listing, original, checkpointHeight) {
  const listingId = exactHash(listing?.listingId);
  const refundEvidence = workMarketV1RefundSnapshotEvidence(listingId);
  const inRefundSnapshot = refundEvidence !== null;
  const status = inRefundSnapshot ? "disabled" : "closed";
  const reason = inRefundSnapshot
    ? "work-market-v2-cutover"
    : "work-market-v1-refund-snapshot-excluded";
  if (
    checkpointHeight < WORK_MARKET_V2_ACTIVATION_HEIGHT ||
    !isLegacyWorkMarketListing(original) ||
    !isLegacyWorkMarketListing(listing) ||
    listing?.saleAuthorization?.version !==
      original?.saleAuthorization?.version ||
    String(listing?.sellerAddress ?? "") !==
      String(original?.sellerAddress ?? "") ||
    exactPositionInteger(original?.blockHeight, 1) === null ||
    exactPositionInteger(original?.blockHeight, 1) >=
      WORK_MARKET_V2_ACTIVATION_HEIGHT ||
    listing?.status !== status ||
    listing?.disabledReason !== reason ||
    exactPositionInteger(listing?.disabledAtBlockHeight, 1) !==
      WORK_MARKET_V2_ACTIVATION_HEIGHT ||
    exactHash(listing?.disabledByTxid) !==
      WORK_MARKET_V2_DECLARATION_TXID ||
    listing?.confirmed !== true ||
    listing?.closedConfirmed !== true ||
    listing?.relic !== inRefundSnapshot ||
    listing?.refundEligible !== inRefundSnapshot
  ) {
    return null;
  }
  if (refundEvidence) {
    const historicalSeal = listingSealPosition(original, {
      historical: true,
    });
    const physicalSeal = listingSealPosition(listing);
    const snapshotHeight = exactPositionInteger(
      refundEvidence.listingBlockHeight,
      1,
    );
    if (
      snapshotHeight === null ||
      snapshotHeight >= WORK_MARKET_V2_ACTIVATION_HEIGHT ||
      refundEvidence.version !== original.saleAuthorization.version ||
      refundEvidence.sellerAddress !== original.sellerAddress ||
      !historicalSeal || !physicalSeal ||
      (refundEvidence.sealed === true
        ? !TXID.test(exactHash(refundEvidence.sealTxid)) ||
          historicalSeal.kind !== "confirmed" ||
          physicalSeal.kind !== "confirmed" ||
          historicalSeal.txid !== exactHash(refundEvidence.sealTxid) ||
          physicalSeal.txid !== historicalSeal.txid ||
          historicalSeal.blockHeight !== snapshotHeight ||
          physicalSeal.blockHeight !== snapshotHeight
        : refundEvidence.sealed !== false ||
          exactHash(refundEvidence.sealTxid) !== "" ||
          historicalSeal.kind !== "absent" ||
          physicalSeal.kind !== "absent" ||
          exactPositionInteger(original.blockHeight, 1) !== snapshotHeight)
    ) {
      return null;
    }
  }
  const closedTxid = exactHash(listing?.closedTxid);
  if (TXID.test(closedTxid)) {
    const raw = { ...listing, status: "closed" };
    const closeHeight = exactPositionInteger(listing.closedBlockHeight, 1);
    const transactionHeight = exactPositionInteger(
      listing.closeTransactionBlockHeight,
      1,
    );
    return exactHash(listing.closeTxid) === closedTxid &&
      (transactionHeight === null || transactionHeight === closeHeight) &&
      canonicalOutspendClosePosition(raw, original) &&
      canonicalOutspendCloseFee(raw) !== null
      ? { listing: raw, closed: true }
      : null;
  }
  if (
    closedTxid ||
    exactHash(listing?.closeTxid) ||
    exactHash(listing?.closedBlockHash) ||
    listing?.closedBlockHeight != null ||
    listing?.closedBlockIndex != null ||
    listing?.closeTransactionBlockHeight != null ||
    listing?.closedVin != null ||
    listing?.closedByCanonicalOutpointSpend === true ||
    listing?.closedMinerFeeCanonical === true ||
    listing?.closedMinerFeeSats != null ||
    listing?.closedCanonicalMinerFeeSats != null ||
    Boolean(listing?.closedMinerFeeSource)
  ) {
    return null;
  }
  return {
    listing: { ...listing, closedConfirmed: false, status: "active" },
    closed: false,
  };
}

function canonicalOutspendClosePosition(listing, original) {
  const authorization = original?.saleAuthorization ?? {};
  const expectedAnchorTxid = exactHash(
    authorization.anchorTxid || original?.listingId,
  );
  const expectedAnchorVout = exactPositionInteger(
    authorization.anchorVout,
    0,
  );
  return (
    authorization.anchorType === "sale-ticket-v1" &&
    TXID.test(expectedAnchorTxid) &&
    expectedAnchorTxid === exactHash(
      listing?.saleTicketTxid || listing?.listingId,
    ) &&
    expectedAnchorVout !== null &&
    expectedAnchorVout === exactPositionInteger(
      listing?.saleTicketVout,
      0,
    ) &&
    exactPositionInteger(listing?.closedBlockHeight, 1) !== null &&
    listing?.closedConfirmed === true &&
    listing?.closedByCanonicalOutpointSpend === true &&
    ["closed", "delisted"].includes(listing?.status) &&
    TXID.test(exactHash(listing?.closedTxid)) &&
    TXID.test(exactHash(listing?.closedBlockHash)) &&
    exactPositionInteger(listing?.closedBlockIndex, 0) !== null &&
    exactPositionInteger(listing?.closedVin, 0) !== null
  );
}

function canonicalOutspendCloseFee(listing) {
  const fee = exactPositionInteger(listing?.closedMinerFeeSats, 0);
  return listing?.closedMinerFeeCanonical === true &&
    listing?.closedMinerFeeSource ===
      "proof-indexer-canonical-outpoint-spend" &&
    fee !== null
    ? fee
    : null;
}

function futureCanonicalOutspendClose(
  listing,
  original,
  checkpointHeight,
) {
  return canonicalOutspendClosePosition(listing, original) &&
    exactPositionInteger(listing.closedBlockHeight, 1) > checkpointHeight;
}

// The relational listing is current at the tip. A range replay must never
// inherit a later seal, pending seal, or its seller-signed terms at H.
function listingSealPosition(listing, { historical = false } = {}) {
  const txid = exactHash(listing?.sealTxid);
  const positionFields = [
    "sealBlockHash",
    "sealBlockHeight",
    "sealBlockIndex",
    "sealProtocolVout",
    "sealRecordOrdinal",
    "sealTransactionBlockHeight",
  ];
  const hasPosition = positionFields.some((key) =>
    listing?.[key] !== undefined &&
    listing?.[key] !== null &&
    listing?.[key] !== ""
  );
  if (!txid && !hasPosition && listing?.sealConfirmed !== true) {
    return { kind: "absent" };
  }
  if (!TXID.test(txid)) return null;
  if (listing?.sealConfirmed === false && !historical) {
    return !hasPosition && ["active", "sealing"].includes(listing?.status)
      ? { kind: "pending" }
      : null;
  }
  const blockHash = exactHash(listing?.sealBlockHash);
  const blockHeight = exactPositionInteger(listing?.sealBlockHeight, 1);
  const blockIndex = exactPositionInteger(listing?.sealBlockIndex, 0);
  const protocolVout = exactPositionInteger(listing?.sealProtocolVout, 0);
  const recordOrdinal = exactPositionInteger(listing?.sealRecordOrdinal, 0);
  const transactionHeight = exactPositionInteger(
    listing?.sealTransactionBlockHeight,
    1,
  );
  if (
    listing?.sealConfirmed !== true ||
    !TXID.test(blockHash) ||
    blockHeight === null ||
    blockIndex === null ||
    protocolVout === null ||
    recordOrdinal === null ||
    (transactionHeight !== null && transactionHeight !== blockHeight)
  ) {
    return null;
  }
  return {
    kind: "confirmed",
    txid,
    blockHash,
    blockHeight,
    blockIndex,
    protocolVout,
    recordOrdinal,
  };
}

function checkpointListingSeal(
  listing,
  original,
  checkpointHeight,
  closed,
  futureClose,
) {
  const historical = listingSealPosition(original, { historical: true });
  const physical = listingSealPosition(listing);
  if (!historical || !physical) return null;
  if (
    historical.kind === "confirmed" &&
    historical.blockHeight > checkpointHeight
  ) {
    return null;
  }
  if (physical.kind === "confirmed") {
    if (physical.blockHeight <= checkpointHeight) {
      if (
        historical.kind !== "confirmed" ||
        [
          "txid", "blockHash", "blockHeight", "blockIndex",
          "protocolVout", "recordOrdinal",
        ].some((key) => physical[key] !== historical[key])
      ) {
        return null;
      }
    }
  } else if (
    (physical.kind === "absent" && historical.kind === "confirmed") ||
    (physical.kind === "pending" && closed)
  ) {
    return null;
  }
  if (
    physical.kind === "confirmed" &&
    physical.blockHeight > checkpointHeight &&
    !["active", "sealing", "sealed", "closed", "sold", "delisted"].includes(
      listing?.status,
    )
  ) {
    return null;
  }
  if (
    (physical.kind === "pending" ||
      (physical.kind === "confirmed" &&
        physical.blockHeight > checkpointHeight)) &&
    !String(original?.status ?? "").trim()
  ) {
    return null;
  }
  // The bounded event projection is the replay record. The current row is
  // used only as independently checked evidence for opening and closure; its
  // mutable payload cannot introduce later terms, seal costs, or timestamps.
  const projected = { ...original };
  if (historical.kind === "confirmed") {
    // The bounded activity reader has the event height but does not emit
    // this transaction-height alias. Its exact canonical position supplies it.
    projected.sealTransactionBlockHeight = historical.blockHeight;
  }
  const authorization = original?.saleAuthorization ?? {};
  if (authorization.anchorType === "sale-ticket-v1") {
    const anchorTxid = exactHash(
      authorization.anchorTxid || original?.listingId,
    );
    const anchorVout = exactPositionInteger(authorization.anchorVout, 0);
    const physicalAnchorTxid = exactHash(
      listing?.saleTicketTxid || listing?.listingId,
    );
    if (
      !TXID.test(anchorTxid) ||
      anchorVout === null ||
      physicalAnchorTxid !== anchorTxid ||
      exactPositionInteger(listing?.saleTicketVout, 0) !== anchorVout
    ) {
      return null;
    }
    projected.saleTicketTxid = anchorTxid;
    projected.saleTicketVout = anchorVout;
    const anchorValue = exactPositionInteger(
      authorization.anchorValueSats,
      0,
    );
    if (anchorValue !== null) {
      const physicalValue = exactPositionInteger(
        listing?.saleTicketValueSats,
        0,
      );
      if (physicalValue !== null && physicalValue !== anchorValue) {
        return null;
      }
      projected.saleTicketValueSats = anchorValue;
    }
  }
  if (closed && !futureClose) {
    const canonicalFeeAlias = listing?.closedCanonicalMinerFeeSats;
    if (canonicalFeeAlias !== undefined &&
      canonicalFeeAlias !== null &&
      canonicalFeeAlias !== "") {
      const fee = exactPositionInteger(listing?.closedMinerFeeSats, 0);
      if (
        listing?.closedMinerFeeCanonical !== true ||
        fee === null ||
        exactPositionInteger(canonicalFeeAlias, 0) !== fee
      ) {
        return null;
      }
      projected.closedCanonicalMinerFeeSats = fee;
    }
    for (const key of [
      "buyerAddress", "closeTxid", "closeTransactionBlockHeight",
      "closedAt", "closedBlockHash", "closedBlockHeight",
      "closedBlockIndex", "closedByCanonicalOutpointSpend",
      "closedConfirmed", "closedMinerFeeCanonical",
      "closedMinerFeeSats", "closedMinerFeeSource",
      "closedProtocolVout", "closedRecordOrdinal",
      "closedTxid", "closedVin", "saleAt", "saleBlockHash",
      "saleBlockHeight", "saleBlockIndex", "saleConfirmed",
      "saleProtocolVout", "saleRecordOrdinal",
      "saleTransactionBlockHeight", "saleTxid",
    ]) {
      if (Object.prototype.hasOwnProperty.call(listing, key)) {
        projected[key] = listing[key];
      }
    }
    projected.status = listing.status;
  }
  return projected;
}

function historicalWorkListingLifecycle(
  table,
  historical,
  model,
  checkpointHeight,
) {
  const originalListings = workItems(historical?.listings);
  const originalById = new Map();
  for (const listing of originalListings) {
    const listingId = exactHash(listing?.listingId);
    if (!TXID.test(listingId) || originalById.has(listingId)) return null;
    originalById.set(listingId, listing);
  }

  const historicalClosedById = new Map();
  for (const listing of workItems(historical?.closedListings)) {
    const listingId = exactHash(listing?.listingId);
    if (
      !originalById.has(listingId) ||
      historicalClosedById.has(listingId) ||
      listing?.closedConfirmed !== true ||
      !TXID.test(exactHash(listing?.closedTxid))
    ) {
      return null;
    }
    historicalClosedById.set(listingId, listing);
  }
  const matchedSaleByListingId = exactWorkSalesByListingId(
    table,
    historical,
    model,
  );
  if (!matchedSaleByListingId) return null;

  const currentListings = workItems(table?.listings);
  const currentClosedListings = workItems(table?.closedListings);
  const seen = new Set();
  let historicalCloseCount = 0;
  const project = (current, physicallyClosed) => {
    const listingId = exactHash(current?.listingId);
    const original = originalById.get(listingId);
    const matchedSaleTxid = matchedSaleByListingId.get(listingId);
    const historicalClose = historicalClosedById.get(listingId);
    const v2Cutover = [
      "work-market-v2-cutover",
      "work-market-v1-refund-snapshot-excluded",
    ].includes(current?.disabledReason);
    const rawCutover = v2Cutover && physicallyClosed
      ? rawLegacyV2CutoverListing(current, original, checkpointHeight)
      : null;
    if (v2Cutover && !rawCutover) return null;
    const listing = rawCutover?.listing ?? current;
    const closed = rawCutover?.closed ?? physicallyClosed;
    const openingPosition = originalListingPosition(
      listing,
      original,
      matchedSaleTxid,
      closed,
    );
    const originalUnits = movementUnits(original, model);
    const physicalSubatoms = movementUnits(
      listing,
      WORK_SUBATOM_PROJECTION_MODEL,
    );
    const factor = model === WORK_ATOMIC_PROJECTION_MODEL
      ? WORK_SUBATOM_CONVERSION_FACTOR
      : 1n;
    const physicalCloseHeight = exactPositionInteger(
      listing?.closedBlockHeight,
      1,
    );
    const futureClose = closed &&
      futureCanonicalOutspendClose(
        listing,
        original,
        checkpointHeight,
      );
    if (
      seen.has(listingId) ||
      openingPosition === null ||
      originalUnits === null ||
      physicalSubatoms !== originalUnits * factor ||
      (!closed && historicalClose) ||
      (closed && futureClose && (historicalClose || matchedSaleTxid)) ||
      (closed && !futureClose && !historicalClose &&
        canonicalOutspendCloseFee(listing) === null) ||
      (closed && !futureClose && (
        physicalCloseHeight === null ||
        physicalCloseHeight > checkpointHeight ||
        (historicalClose
          ? exactHash(historicalClose.closedTxid) !==
              exactHash(listing.closedTxid) ||
            (
              exactPositionInteger(historicalClose.closedBlockHeight, 1) !== null &&
              physicalCloseHeight !==
                exactPositionInteger(historicalClose.closedBlockHeight, 1)
            )
          : !canonicalOutspendClosePosition(listing, original))
      ))
    ) {
      return null;
    }
    const atCheckpoint = checkpointListingSeal(
      listing,
      original,
      checkpointHeight,
      closed,
      futureClose,
    );
    if (!atCheckpoint) return null;
    seen.add(listingId);
    if (futureClose) {
      // The physical table describes a later canonical outspend. Its opening
      // amount and position have been checked, but H still owns an open row.
      return atCheckpoint;
    }
    if (closed && historicalClose) historicalCloseCount += 1;
    if (model === WORK_SUBATOM_PROJECTION_MODEL) {
      return { ...atCheckpoint, ...openingPosition };
    }
    const {
      amountSubatoms: _amountSubatoms,
      creditAmountMovedSubatoms: _creditAmountMovedSubatoms,
      precisionModel: _precisionModel,
      tokenAmount: _tokenAmount,
      tokenAmountAtoms: _tokenAmountAtoms,
      tokenAmountSubatoms: _tokenAmountSubatoms,
      ...lifecycle
    } = atCheckpoint;
    void _amountSubatoms;
    void _creditAmountMovedSubatoms;
    void _precisionModel;
    void _tokenAmount;
    void _tokenAmountAtoms;
    void _tokenAmountSubatoms;
    return {
      ...lifecycle,
      ...openingPosition,
      amount: formatWorkAtoms(originalUnits.toString()),
      amountAtoms: originalUnits.toString(),
      amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
      decimals: 8,
      unitScale: WORK_UNIT_SCALE_TEXT,
    };
  };
  const listings = currentListings.map((listing) => project(listing, false));
  const closedListings = currentClosedListings.map(
    (listing) => project(listing, true),
  );
  if (
    listings.some((item) => !item) ||
    closedListings.some((item) => !item) ||
    seen.size !== originalById.size ||
    historicalCloseCount !== historicalClosedById.size
  ) {
    return null;
  }
  const historicallyClosedIds = new Set(
    currentClosedListings
      .filter((listing) => {
        const height = exactPositionInteger(listing.closedBlockHeight, 1);
        return height !== null && height <= checkpointHeight;
      })
      .map((listing) => exactHash(listing.listingId)),
  );
  return {
    closedListings: closedListings.filter(
      (listing) => historicallyClosedIds.has(exactHash(listing.listingId)),
    ),
    listings: [
      ...listings,
      ...closedListings.filter(
        (listing) => !historicallyClosedIds.has(exactHash(listing.listingId)),
      ),
    ],
  };
}

function v8ListingAuthorization(listing) {
  return String(
    listing?.saleAuthorization?.version ??
      listing?.listingAuthorization?.version ??
      "",
  ).trim().toLowerCase() === WORK_AMO_V8_AUTH_VERSION;
}

function historicalQ16V8ListingLifecycle(
  table,
  historical,
  matchedSaleByListingId,
  checkpointHeight,
) {
  const originalById = new Map();
  for (const listing of workItems(historical?.listings).filter(
    v8ListingAuthorization,
  )) {
    const listingId = exactHash(listing?.listingId);
    if (!TXID.test(listingId) || originalById.has(listingId)) return false;
    originalById.set(listingId, listing);
  }
  const historicalClosedById = new Map();
  for (const listing of workItems(historical?.closedListings)) {
    const listingId = exactHash(listing?.listingId);
    if (!originalById.has(listingId)) continue;
    if (historicalClosedById.has(listingId)) return false;
    historicalClosedById.set(listingId, listing);
  }
  const currentListings = workItems(table?.listings).filter(
    v8ListingAuthorization,
  );
  const currentClosedListings = workItems(table?.closedListings).filter(
    (listing) =>
      v8ListingAuthorization(listing) ||
      originalById.has(exactHash(listing?.listingId)),
  );
  const seen = new Set();
  for (const [items, closed] of [
    [currentListings, false],
    [currentClosedListings, true],
  ]) {
    for (const listing of items) {
      const listingId = exactHash(listing?.listingId);
      const original = originalById.get(listingId);
      const canonicalClose = historicalClosedById.get(listingId);
      const saleTxid = matchedSaleByListingId.get(listingId);
      const openingPosition = originalListingPosition(
        listing,
        original,
        saleTxid,
        closed,
      );
      const originalUnits = movementUnits(
        original,
        WORK_SUBATOM_PROJECTION_MODEL,
      );
      const tableUnits = movementUnits(
        listing,
        WORK_SUBATOM_PROJECTION_MODEL,
      );
      const futureClose = closed &&
        futureCanonicalOutspendClose(
          listing,
          original,
          checkpointHeight,
        );
      if (
        seen.has(listingId) ||
        openingPosition === null ||
        originalUnits === null ||
        tableUnits !== originalUnits ||
        (closed && futureClose && canonicalClose) ||
        (closed && !futureClose && (
          exactPositionInteger(listing.closedBlockHeight, 1) === null ||
          exactPositionInteger(listing.closedBlockHeight, 1) >
            checkpointHeight ||
          (canonicalClose
            ? canonicalClose.closedConfirmed !== true ||
              !TXID.test(exactHash(canonicalClose.closedTxid)) ||
              exactHash(listing.closedTxid) !==
                exactHash(canonicalClose.closedTxid)
            : !canonicalOutspendClosePosition(listing, original))
        )) ||
        (!closed && canonicalClose)
      ) {
        return false;
      }
      seen.add(listingId);
    }
  }
  return seen.size === originalById.size &&
    historicalClosedById.size === currentClosedListings.filter(
      (listing) => historicalClosedById.has(exactHash(listing.listingId)),
    ).length;
}

// The physical table remains Q16 throughout the replay. Confirmed historical
// movements independently reconstruct every holder; a Q8 checkpoint may use
// the old unit only when every physical Q16 value is an exact Q8 multiple.
export function replayTokenTableWorkBridge(
  table,
  historical,
  model,
  checkpointHeight,
) {
  if (
    !Number.isSafeInteger(checkpointHeight) ||
    checkpointHeight < REPLAY_FROM_HEIGHT - 1 ||
    Number(historical?.indexedThroughBlock) !== checkpointHeight ||
    ![WORK_ATOMIC_PROJECTION_MODEL, WORK_SUBATOM_PROJECTION_MODEL].includes(
      model,
    ) ||
    table?.source !== "proof-indexer-token-state-tables" ||
    workItems(table?.tokens).length !== 1 ||
    workItems(historical?.tokens).length !== 1
  ) {
    return null;
  }
  const tableToken = workItems(table.tokens)[0];
  const historicalToken = workItems(historical.tokens)[0];
  if (
    tableToken.amountStorageModel !== WORK_SUBATOM_PROJECTION_MODEL ||
    Number(tableToken.decimals) !== 16 ||
    String(tableToken.unitScale ?? "") !== WORK_SUBATOM_UNIT_SCALE_TEXT ||
    historicalToken.amountStorageModel !== model ||
    String(historicalToken.unitScale ?? "") !==
      (model === WORK_ATOMIC_PROJECTION_MODEL
        ? WORK_UNIT_SCALE_TEXT
        : WORK_SUBATOM_UNIT_SCALE_TEXT)
  ) {
    return null;
  }
  const historicalState = historicalWorkBalances(historical, model);
  if (!historicalState) return null;
  if (
    model === WORK_ATOMIC_PROJECTION_MODEL &&
    !exactQ8WorkMovements(table, historical, checkpointHeight)
  ) {
    return null;
  }
  const factor = model === WORK_ATOMIC_PROJECTION_MODEL
    ? WORK_SUBATOM_CONVERSION_FACTOR
    : 1n;
  const expectedSubatoms = historicalState.supply * factor;
  const declaredSubatoms = canonicalUnits(
    tableToken.confirmedSupplySubatoms,
    WORK_SUBATOM_PROJECTION_MODEL,
  );
  if (declaredSubatoms !== expectedSubatoms) return null;

  const tableMintIdentities = [];
  let tableMintSubatomsTotal = 0n;
  for (const mint of workItems(table?.mints)) {
    if (mint?.confirmed !== true) return null;
    const subatoms = tableMintSubatoms(mint);
    if (subatoms === null || subatoms % factor !== 0n) return null;
    const identity = mintIdentity(mint, subatoms / factor);
    if (!identity) return null;
    tableMintIdentities.push(identity);
    tableMintSubatomsTotal += subatoms;
  }
  if (
    tableMintSubatomsTotal !== expectedSubatoms ||
    JSON.stringify(tableMintIdentities.sort()) !==
      JSON.stringify(historicalState.mintIdentities)
  ) {
    return null;
  }

  const tableHolders = workItems(table?.holders);
  const holderAddresses = new Set();
  const historicalHolders = [];
  let heldSubatoms = 0n;
  for (const holder of tableHolders) {
    const address = String(holder?.address ?? "").trim();
    const subatoms = canonicalUnits(
      holder?.balanceSubatoms,
      WORK_SUBATOM_PROJECTION_MODEL,
    );
    const pendingSubatoms = canonicalUnits(
      holder?.pendingDeltaSubatoms,
      WORK_SUBATOM_PROJECTION_MODEL,
      { signed: true, zero: true },
    );
    if (
      !address || holderAddresses.has(address) ||
      holder?.amountStorageModel !== WORK_SUBATOM_PROJECTION_MODEL ||
      subatoms === null || pendingSubatoms === null ||
      subatoms % factor !== 0n || pendingSubatoms % factor !== 0n ||
      historicalState.balances.get(address) !== subatoms / factor
    ) {
      return null;
    }
    holderAddresses.add(address);
    heldSubatoms += subatoms;
    if (model === WORK_ATOMIC_PROJECTION_MODEL) {
      const balanceAtoms = workSubatomsToLegacyAtoms(
        subatoms.toString(),
      );
      const pendingDeltaAtoms = workSubatomsToLegacyAtoms(
        pendingSubatoms.toString(),
        { allowNegative: true, allowZero: true },
      );
      historicalHolders.push({
        address,
        amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
        balance: formatWorkAtoms(balanceAtoms),
        balanceAtoms,
        decimals: 8,
        pendingDelta: formatWorkAtoms(pendingDeltaAtoms, { allowNegative: true }),
        pendingDeltaAtoms,
        registryAddress: holder.registryAddress,
        ticker: holder.ticker,
        tokenId: WORK_TOKEN_ID,
        unitScale: WORK_UNIT_SCALE_TEXT,
        updatedAt: holder.updatedAt,
      });
    }
  }
  if (
    holderAddresses.size !== historicalState.balances.size ||
    heldSubatoms !== expectedSubatoms
  ) {
    return null;
  }
  const listingLifecycle = historicalWorkListingLifecycle(
    table,
    historical,
    model,
    checkpointHeight,
  );
  const q16SalesByListingId = model === WORK_SUBATOM_PROJECTION_MODEL
    ? exactWorkSalesByListingId(table, historical, model)
    : null;
  if (
    !listingLifecycle ||
    (model === WORK_SUBATOM_PROJECTION_MODEL && (
      !q16SalesByListingId ||
      !historicalQ16V8ListingLifecycle(
        table,
        historical,
        q16SalesByListingId,
        checkpointHeight,
      )
    ))
  ) {
    return null;
  }
  return {
    historicalClosedListings: listingLifecycle.closedListings,
    historicalHolders,
    historicalListings: listingLifecycle.listings,
    historicalSupplyAtoms:
      model === WORK_ATOMIC_PROJECTION_MODEL
        ? historicalState.supply.toString()
        : "",
    workMintCount: historicalState.mintIdentities.length,
    workHolderCount: holderAddresses.size,
    workSupplySubatoms: expectedSubatoms.toString(),
  };
}
