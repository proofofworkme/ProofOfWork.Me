#!/usr/bin/env node

import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PWID_RAW_REPLAY_ACTIVATION_HEIGHT,
} from "../server/id-registry-audit-contract.mjs";

bitcoin.initEccLib(ecc);

const NETWORK = "livenet";
const REGISTRY_ADDRESS = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const ID_PROTOCOL_PREFIX = "pwid1:";
const ID_REGISTRATION_PRICE_SATS = 1000;

export function compareCanonicalUtf8(left, right) {
  return Buffer.compare(
    Buffer.from(String(left ?? ""), "utf8"),
    Buffer.from(String(right ?? ""), "utf8"),
  );
}

function integerSetting(env, name, fallback, minimum, maximum) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function booleanSetting(env, name, fallback = false) {
  const value = String(env[name] ?? (fallback ? "1" : "0")).trim();
  if (/^(?:1|true|yes)$/iu.test(value)) return true;
  if (/^(?:0|false|no)$/iu.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function normalizedApiBase(value) {
  const url = new URL(String(value ?? "http://127.0.0.1:8081"));
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("POW_ID_AUDIT_API_BASE must be an HTTP(S) origin or path base without credentials, query, or fragment.");
  }
  return url.toString().replace(/\/+$/u, "");
}

function isLoopbackApiBase(apiBase) {
  const hostname = new URL(apiBase).hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return hostname === "127.0.0.1" || hostname === "::1";
}

function hasExactOrigin(value, expectedBase) {
  return new URL(value).origin === new URL(expectedBase).origin;
}

export function auditConfiguration(env = process.env) {
  const apiBase = normalizedApiBase(env.POW_ID_AUDIT_API_BASE);
  const addressApiBase = normalizedApiBase(env.POW_ID_AUDIT_ADDRESS_API_BASE ?? apiBase);
  const production = booleanSetting(env, "POW_ID_AUDIT_PRODUCTION", true);
  if (
    production &&
    (!isLoopbackApiBase(apiBase) || !isLoopbackApiBase(addressApiBase))
  ) {
    throw new Error(
      "POW_ID_AUDIT_PRODUCTION requires numeric loopback API and address bases.",
    );
  }
  if (production && !hasExactOrigin(addressApiBase, apiBase)) {
    throw new Error(
      "POW_ID_AUDIT_PRODUCTION requires API and address bases on the same exact origin.",
    );
  }
  const internalVerifierToken = String(env.POW_INTERNAL_VERIFIER_TOKEN ?? "").trim();
  if (production && Buffer.byteLength(internalVerifierToken) < 32) {
    throw new Error(
      "POW_ID_AUDIT_PRODUCTION requires POW_INTERNAL_VERIFIER_TOKEN with at least 32 bytes.",
    );
  }
  return {
    addressApiBase,
    apiBase,
    coverageTimeoutMs: integerSetting(
      env,
      "POW_ID_AUDIT_COVERAGE_TIMEOUT_MS",
      300_000,
      1_000,
      600_000,
    ),
    internalVerifierToken,
    production,
    retries: integerSetting(env, "POW_ID_AUDIT_RETRIES", 0, 0, 3),
    retryDelayMs: integerSetting(env, "POW_ID_AUDIT_RETRY_DELAY_MS", 500, 0, 30_000),
    timeoutMs: integerSetting(env, "POW_ID_AUDIT_TIMEOUT_MS", 15_000, 100, 120_000),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, config, attempt = 0, timeoutMs = config.timeoutMs) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(config.internalVerifierToken &&
        isLoopbackApiBase(url) &&
        hasExactOrigin(url, config.apiBase)
          ? { "x-pow-internal-verifier": config.internalVerifierToken }
          : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < config.retries) {
        await sleep(config.retryDelayMs * (attempt + 1));
        return fetchJson(url, config, attempt + 1, timeoutMs);
      }
      throw new Error(`${url} returned ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (attempt < config.retries && (error?.name === "TimeoutError" || error?.name === "TypeError")) {
      await sleep(config.retryDelayMs * (attempt + 1));
      return fetchJson(url, config, attempt + 1, timeoutMs);
    }
    throw error;
  }
}

async function fetchAddressTransactionsPage(path, config) {
  const transactions = await fetchJson(
    `${config.addressApiBase}/api/v1/address/${encodeURIComponent(REGISTRY_ADDRESS)}/${path}?network=${NETWORK}`,
    config,
  );
  return Array.isArray(transactions) ? transactions : [];
}

function txidSetSha256(txids) {
  return createHash("sha256")
    .update([...txids].sort().join("\n"), "utf8")
    .digest("hex");
}

function exactTxidSet(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const txids = value.map((txid) => String(txid ?? "").trim().toLowerCase());
  if (
    txids.some((txid) => !/^[0-9a-f]{64}$/u.test(txid)) ||
    new Set(txids).size !== txids.length
  ) {
    throw new Error(`${label} contains an invalid or duplicate txid.`);
  }
  return txids.sort();
}

function exactNonnegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return number;
}

function checkedSatsNumber(value, label) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`${label} is not an exact non-negative proof total.`);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the exact JSON proof range.`);
  }
  return Number(value);
}

function canonicalAuditJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Registry projection contains an inexact number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalAuditJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareCanonicalUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonicalAuditJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Registry projection contains an unsupported value.");
}

function projectionSha256(value) {
  return createHash("sha256")
    .update(canonicalAuditJson(value), "utf8")
    .digest("hex");
}

function exactProjectionString(value, label, allowEmpty = false) {
  const text = String(value ?? "");
  if ((!allowEmpty && !text) || text !== String(value ?? "")) {
    throw new Error(`${label} is not an exact string.`);
  }
  return text;
}

function exactProjectionTxid(value, label) {
  const txid = exactProjectionString(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(txid) || txid !== value) {
    throw new Error(`${label} is not a canonical txid.`);
  }
  return txid;
}

function exactConfirmedProjection(value) {
  if (!Array.isArray(value)) {
    throw new Error("Confirmed registry projection must be an array.");
  }
  const entries = value.map((record) => {
    const id = exactProjectionString(record?.id, "Confirmed registry ID");
    if (id !== id.trim().toLowerCase()) {
      throw new Error("Confirmed registry ID is not canonical.");
    }
    const blockHeight = exactNonnegativeInteger(
      record?.blockHeight,
      `Confirmed registry block height for ${id}`,
    );
    const blockIndex = exactNonnegativeInteger(
      record?.blockIndex,
      `Confirmed registry block index for ${id}`,
    );
    if (blockHeight < 1) {
      throw new Error(`Confirmed registry block height for ${id} is invalid.`);
    }
    const updatedHeight = exactNonnegativeInteger(
      record?.updatedHeight,
      `Confirmed registry update height for ${id}`,
    );
    const ownerAddress = exactProjectionString(
      record?.ownerAddress,
      `Confirmed registry owner for ${id}`,
    );
    const receiveAddress = exactProjectionString(
      record?.receiveAddress,
      `Confirmed registry receiver for ${id}`,
    );
    if (
      updatedHeight < blockHeight ||
      !isValidBitcoinAddress(ownerAddress) ||
      !isValidBitcoinAddress(receiveAddress)
    ) {
      throw new Error(`Confirmed registry current state for ${id} is invalid.`);
    }
    return {
      blockHeight,
      blockIndex,
      id,
      lastEventTxid: exactProjectionTxid(
        record?.lastEventTxid,
        `Confirmed registry last event for ${id}`,
      ),
      ownerAddress,
      pgpKey: exactProjectionString(
        record?.pgpKey,
        `Confirmed registry PGP key for ${id}`,
        true,
      ),
      receiveAddress,
      txid: exactProjectionTxid(record?.txid, `Confirmed registry txid for ${id}`),
      updatedHeight,
    };
  });
  entries.sort(
    (left, right) =>
      compareCanonicalUtf8(left.id, right.id) ||
      compareCanonicalUtf8(left.txid, right.txid),
  );
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("Confirmed registry projection repeats an ID.");
  }
  return entries;
}

function exactPendingRecordProjection(value) {
  if (!Array.isArray(value)) {
    throw new Error("Pending registry record projection must be an array.");
  }
  const entries = value.map((record) => {
    const id = exactProjectionString(record?.id, "Pending registry ID");
    if (id !== id.trim().toLowerCase()) {
      throw new Error("Pending registry ID is not canonical.");
    }
    const ownerAddress = exactProjectionString(
      record?.ownerAddress,
      `Pending registry owner for ${id}`,
    );
    const receiveAddress = exactProjectionString(
      record?.receiveAddress,
      `Pending registry receiver for ${id}`,
    );
    if (
      !isValidBitcoinAddress(ownerAddress) ||
      !isValidBitcoinAddress(receiveAddress)
    ) {
      throw new Error(`Pending registry current state for ${id} is invalid.`);
    }
    return {
      id,
      ownerAddress,
      pgpKey: exactProjectionString(
        record?.pgpKey,
        `Pending registry PGP key for ${id}`,
        true,
      ),
      receiveAddress,
      txid: exactProjectionTxid(record?.txid, `Pending registry txid for ${id}`),
    };
  });
  entries.sort(
    (left, right) =>
      compareCanonicalUtf8(left.id, right.id) ||
      compareCanonicalUtf8(left.txid, right.txid),
  );
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("Pending registry projection repeats an ID.");
  }
  return entries;
}

const PENDING_EVENT_STRING_FIELDS = [
  "buyerAddress",
  "currentOwnerAddress",
  "currentReceiveAddress",
  "id",
  "kind",
  "listingId",
  "ownerAddress",
  "receiveAddress",
  "sellerAddress",
  "transferVersion",
  "txid",
];

function exactPendingEventProjection(value) {
  if (!Array.isArray(value)) {
    throw new Error("Pending registry mutation projection must be an array.");
  }
  const entries = value.map((event) => {
    const normalized = {};
    for (const field of PENDING_EVENT_STRING_FIELDS) {
      normalized[field] = exactProjectionString(
        event?.[field],
        `Pending registry mutation ${field}`,
        field !== "kind" && field !== "txid",
      );
    }
    normalized.txid = exactProjectionTxid(
      normalized.txid,
      "Pending registry mutation txid",
    );
    if (
      event?.priceSats !== null &&
      (!Number.isSafeInteger(Number(event?.priceSats)) ||
        Number(event.priceSats) < 0)
    ) {
      throw new Error("Pending registry mutation price is inexact.");
    }
    normalized.priceSats =
      event?.priceSats === null ? null : Number(event.priceSats);
    return normalized;
  });
  entries.sort(
    (left, right) =>
      compareCanonicalUtf8(left.txid, right.txid) ||
      compareCanonicalUtf8(left.kind, right.kind) ||
      compareCanonicalUtf8(left.id, right.id) ||
      compareCanonicalUtf8(left.listingId, right.listingId),
  );
  return entries;
}

function exactLifecycleProjectionArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  canonicalAuditJson(value);
  return value;
}

function exactLifecycleEventProjection(value, checkpointHeight) {
  if (!Array.isArray(value)) {
    throw new Error("Registry lifecycle event projection must be an array.");
  }
  let previous = null;
  return value.map((event, index) => {
    const kind = exactProjectionString(
      event?.kind,
      `Registry lifecycle event ${index} kind`,
    );
    if (
      ![
        "id-buy",
        "id-delist",
        "id-list",
        "id-register",
        "id-seal",
        "id-transfer",
        "id-update",
      ].includes(kind) ||
      event?.confirmed !== true
    ) {
      throw new Error(`Registry lifecycle event ${index} is not accepted and confirmed.`);
    }
    const expectedFee = kind === "id-register" ? 1_000 : 546;
    const blockHeight = exactNonnegativeInteger(
      event?.blockHeight,
      `Registry lifecycle event ${index} height`,
    );
    const blockIndex = exactNonnegativeInteger(
      event?.blockIndex,
      `Registry lifecycle event ${index} block index`,
    );
    const protocolVout = exactNonnegativeInteger(
      event?.protocolVout,
      `Registry lifecycle event ${index} protocol vout`,
    );
    const recordOrdinal = exactNonnegativeInteger(
      event?.recordOrdinal,
      `Registry lifecycle event ${index} record ordinal`,
    );
    const txid = exactProjectionTxid(
      event?.txid,
      `Registry lifecycle event ${index} txid`,
    );
    const position = { blockHeight, blockIndex, protocolVout, recordOrdinal, txid };
    if (
      blockHeight < 1 ||
      blockHeight > checkpointHeight ||
      (previous &&
        (blockHeight < previous.blockHeight ||
          (blockHeight === previous.blockHeight &&
            (blockIndex < previous.blockIndex ||
              (blockIndex === previous.blockIndex &&
                (protocolVout < previous.protocolVout ||
                  (protocolVout === previous.protocolVout &&
                    (recordOrdinal < previous.recordOrdinal ||
                      (recordOrdinal === previous.recordOrdinal &&
                        compareCanonicalUtf8(txid, previous.txid) <= 0)))))))))
    ) {
      throw new Error("Registry lifecycle events are not in exact canonical block order.");
    }
    previous = position;
    const createdAt = exactProjectionString(
      event?.createdAt,
      `Registry lifecycle event ${index} time`,
    );
    if (new Date(createdAt).toISOString() !== createdAt) {
      throw new Error(`Registry lifecycle event ${index} has no exact Core time.`);
    }
    const address = (field) => {
      const value = exactProjectionString(
        event?.[field],
        `Registry lifecycle event ${index} ${field}`,
        true,
      );
      if (value && !isValidBitcoinAddress(value)) {
        throw new Error(`Registry lifecycle event ${index} has an invalid ${field}.`);
      }
      return value;
    };
    const participants = (Array.isArray(event?.participants)
      ? event.participants
      : [])
      .map((participant) => {
        const normalized = exactProjectionString(
          participant,
          `Registry lifecycle event ${index} participant`,
        );
        if (!isValidBitcoinAddress(normalized)) {
          throw new Error(`Registry lifecycle event ${index} has an invalid participant.`);
        }
        return normalized;
      })
      .sort(compareCanonicalUtf8);
    if (
      participants.length < 1 ||
      new Set(participants).size !== participants.length
    ) {
      throw new Error(`Registry lifecycle event ${index} participant set is invalid.`);
    }
    const paymentOutputs = (Array.isArray(event?.paymentOutputs)
      ? event.paymentOutputs
      : [])
      .map((output, paymentIndex) => {
        const paymentAddress = exactProjectionString(
          output?.address,
          `Registry lifecycle event ${index} payment address`,
        );
        const amountSats = exactNonnegativeInteger(
          output?.amountSats,
          `Registry lifecycle event ${index} payment amount`,
        );
        const vout = exactNonnegativeInteger(
          output?.vout,
          `Registry lifecycle event ${index} payment vout`,
        );
        if (!isValidBitcoinAddress(paymentAddress) || amountSats < 1) {
          throw new Error(`Registry lifecycle event ${index} payment ${paymentIndex} is invalid.`);
        }
        return { address: paymentAddress, amountSats, vout };
      })
      .sort(
        (left, right) =>
          left.vout - right.vout ||
          compareCanonicalUtf8(left.address, right.address),
      );
    if (
      new Set(paymentOutputs.map((output) => output.vout)).size !==
      paymentOutputs.length
    ) {
      throw new Error(`Registry lifecycle event ${index} repeats a payment vout.`);
    }
    const registryPaymentSats = checkedSatsNumber(
      paymentOutputs.reduce(
        (total, output) =>
          total + (output.address === REGISTRY_ADDRESS
            ? BigInt(output.amountSats)
            : 0n),
        0n,
      ),
      `Registry lifecycle event ${index} registry payment`,
    );
    if (
      event?.amountSats !== expectedFee ||
      event?.registryPaymentSats !== registryPaymentSats ||
      registryPaymentSats < expectedFee
    ) {
      throw new Error(`Registry lifecycle event ${index} fee math is inconsistent.`);
    }
    const id = exactProjectionString(
      event?.id,
      `Registry lifecycle event ${index} ID`,
      !["id-buy", "id-list", "id-register", "id-transfer", "id-update"].includes(kind),
    );
    if (id && id !== id.trim().toLowerCase()) {
      throw new Error(`Registry lifecycle event ${index} ID is not canonical.`);
    }
    const listingId = exactProjectionString(
      event?.listingId,
      `Registry lifecycle event ${index} listing`,
      true,
    );
    if (listingId && !/^[0-9a-f]{64}$/u.test(listingId)) {
      throw new Error(`Registry lifecycle event ${index} listing is invalid.`);
    }
    const priceSats = event?.priceSats === null
      ? null
      : exactNonnegativeInteger(
          event?.priceSats,
          `Registry lifecycle event ${index} price`,
        );
    const saleAuthorization = event?.saleAuthorization === null
      ? null
      : JSON.parse(canonicalAuditJson(event?.saleAuthorization));
    return {
      amountSats: expectedFee,
      blockHash: exactProjectionTxid(
        event?.blockHash,
        `Registry lifecycle event ${index} block hash`,
      ),
      blockHeight,
      blockIndex,
      buyerAddress: address("buyerAddress"),
      confirmed: true,
      createdAt,
      dataBytes: exactNonnegativeInteger(
        event?.dataBytes,
        `Registry lifecycle event ${index} payload bytes`,
      ),
      id,
      kind,
      listingId,
      listingVersion: exactProjectionString(
        event?.listingVersion,
        `Registry lifecycle event ${index} listing version`,
        true,
      ),
      ownerAddress: address("ownerAddress"),
      participants,
      paymentOutputs,
      pgpKey: exactProjectionString(
        event?.pgpKey,
        `Registry lifecycle event ${index} PGP key`,
        true,
      ),
      priceSats,
      protocolPayloadSha256: exactProjectionTxid(
        event?.protocolPayloadSha256,
        `Registry lifecycle event ${index} payload fingerprint`,
      ),
      protocolVout,
      receiveAddress: address("receiveAddress"),
      recordOrdinal,
      registryPaymentSats,
      saleAuthorization,
      sellerAddress: address("sellerAddress"),
      senderAddress: address("senderAddress"),
      transferVersion: exactProjectionString(
        event?.transferVersion,
        `Registry lifecycle event ${index} transfer version`,
        true,
      ),
      txid,
    };
  });
}

function normalizedRegistryAuditReadFence(value) {
  if (!value || typeof value !== "object") {
    throw new Error("The ID registry audit read fence is missing.");
  }
  const preimage = {
    checkpointHash: exactProjectionTxid(
      value.checkpointHash,
      "ID registry audit fence checkpoint",
    ),
    checkpointHeight: exactNonnegativeInteger(
      value.checkpointHeight,
      "ID registry audit fence height",
    ),
    confirmedTxidCount: exactNonnegativeInteger(
      value.confirmedTxidCount,
      "ID registry audit fence confirmed count",
    ),
    confirmedTxidsSha256: exactProjectionTxid(
      value.confirmedTxidsSha256,
      "ID registry audit fence confirmed fingerprint",
    ),
    electrumCheckpointHash: exactProjectionTxid(
      value.electrumCheckpointHash,
      "ID registry audit fence Electrum checkpoint",
    ),
    electrumCheckpointHeight: exactNonnegativeInteger(
      value.electrumCheckpointHeight,
      "ID registry audit fence Electrum checkpoint height",
    ),
    electrumHeaderSha256: exactProjectionTxid(
      value.electrumHeaderSha256,
      "ID registry audit fence Electrum header fingerprint",
    ),
    indexScanSnapshotId: exactProjectionString(
      value.indexScanSnapshotId,
      "ID registry audit fence index snapshot",
    ),
    indexScanStatus: exactProjectionString(
      value.indexScanStatus,
      "ID registry audit fence index status",
    ),
    pendingMempoolTimeSha256: exactProjectionTxid(
      value.pendingMempoolTimeSha256,
      "ID registry audit fence pending-time fingerprint",
    ),
    pendingTxidCount: exactNonnegativeInteger(
      value.pendingTxidCount,
      "ID registry audit fence pending count",
    ),
    pendingTxidsSha256: exactProjectionTxid(
      value.pendingTxidsSha256,
      "ID registry audit fence pending fingerprint",
    ),
    registryProjectionSha256: exactProjectionTxid(
      value.registryProjectionSha256,
      "ID registry audit fence projection fingerprint",
    ),
    relationalRowsSha256: exactProjectionTxid(
      value.relationalRowsSha256,
      "ID registry audit fence row fingerprint",
    ),
    snapshotSha256: exactProjectionTxid(
      value.snapshotSha256,
      "ID registry audit fence Electrum fingerprint",
    ),
    transitionCount: exactNonnegativeInteger(
      value.transitionCount,
      "ID registry audit fence transition count",
    ),
    transitionSha256: exactProjectionTxid(
      value.transitionSha256,
      "ID registry audit fence transition fingerprint",
    ),
  };
  if (
    preimage.checkpointHeight < 1 ||
    preimage.electrumCheckpointHeight !== preimage.checkpointHeight ||
    preimage.electrumCheckpointHash !== preimage.checkpointHash ||
    preimage.indexScanStatus !== "block-scan-current" ||
    preimage.transitionCount !==
      preimage.checkpointHeight - PWID_RAW_REPLAY_ACTIVATION_HEIGHT + 1
  ) {
    throw new Error("The ID registry audit fence checkpoint is invalid.");
  }
  const fenceSha256 = exactProjectionTxid(
    value.fenceSha256,
    "ID registry audit fence fingerprint",
  );
  if (fenceSha256 !== projectionSha256(preimage)) {
    throw new Error("The ID registry audit read fence is internally inconsistent.");
  }
  return { ...preimage, fenceSha256 };
}

function normalizedRegistryAuditCoverage(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.network !== NETWORK ||
    payload.registryAddress !== REGISTRY_ADDRESS ||
    payload.coverage?.confirmedComplete !== true ||
    payload.coverage?.lifecycleParity?.canonicalSemantics !==
      "legacy-idRegistryStateFromTransactions+post-activation-raw-block-sequencer" ||
    payload.coverage?.lifecycleParity?.chainReplayVerified !== true ||
    payload.coverage?.pendingObservation?.completeWithinScope !== true ||
    payload.coverage?.pendingObservation?.coreMembershipProven !== true ||
    payload.coverage?.pendingObservation?.fenced !== true ||
    payload.coverage?.pendingObservation?.scope !==
      "registry-address-touching-electrum-observation" ||
    payload.coverage?.pendingObservation?.wholeMempoolComplete !== false
  ) {
    throw new Error("The internal ID registry audit endpoint returned incomplete coverage.");
  }

  const lifecycleParity = payload.coverage.lifecycleParity;
  const canonicalRawReplayBlockCount = exactNonnegativeInteger(
    lifecycleParity.canonicalRawReplayBlockCount,
    "Canonical raw ID replay block count",
  );
  const lifecycleHashes = [
    lifecycleParity.canonicalRawClosingStateSha256,
    lifecycleParity.canonicalRawReplayDescriptorSha256,
    lifecycleParity.relationalClosingStateSha256,
  ];
  if (
    lifecycleParity.canonicalRawReplayBlockPaging !==
      "all-transition-discovered-pwid-blocks;bounded-page-recompute" ||
    lifecycleHashes.some(
      (value) => !/^[0-9a-f]{64}$/u.test(String(value ?? "")),
    ) ||
    lifecycleParity.canonicalRawClosingStateSha256 !==
      lifecycleParity.relationalClosingStateSha256
  ) {
    throw new Error("The canonical raw ID lifecycle replay proof is inconsistent.");
  }
  const attemptParity = payload.coverage?.pwidAttemptParity;
  const attemptInteger = (field, label) =>
    exactNonnegativeInteger(attemptParity?.[field], label);
  const attemptRowCount = attemptInteger("rowCount", "PWID audit row count");
  const attemptValidCount = attemptInteger(
    "validCount",
    "PWID valid row count",
  );
  const attemptInvalidCount = attemptInteger(
    "invalidCount",
    "PWID invalid row count",
  );
  const attemptPositionCount = attemptInteger(
    "positionCount",
    "PWID physical position count",
  );
  const acceptedPositionCount = attemptInteger(
    "acceptedPositionCount",
    "PWID accepted position count",
  );
  const mixedOutcomePositionCount = attemptInteger(
    "mixedOutcomePositionCount",
    "PWID mixed-outcome position count",
  );
  const diagnosticRowCount = attemptInteger(
    "diagnosticRowCount",
    "PWID diagnostic row count",
  );
  const canonicalReplayOutcomeCount = attemptInteger(
    "canonicalReplayOutcomeCount",
    "PWID canonical replay outcome count",
  );
  const legacyPositionCount = attemptInteger(
    "legacyPositionCount",
    "PWID legacy position count",
  );
  const postActivationPositionCount = attemptInteger(
    "postActivationPositionCount",
    "PWID post-activation position count",
  );
  const attemptTransactionCount = attemptInteger(
    "transactionCount",
    "PWID carrier transaction count",
  );
  const segmentCount = attemptInteger(
    "segmentCount",
    "PWID streamed parity segment count",
  );
  const maxCarrierPayloadBytes = attemptInteger(
    "maxCarrierPayloadBytes",
    "PWID maximum carrier payload bytes",
  );
  if (
    attemptParity?.physicalCarrierComplete !== true ||
    attemptParity?.invalidOutcomeSemantics !==
      "post-activation-canonical-raw-replay-rejection;pre-activation-qualified-legacy" ||
    attemptParity?.mixedOutcomeRowsQualifiedAs !==
      "pre-activation-same-carrier-contradictory-diagnostic-rows-only" ||
    attemptRowCount !== attemptValidCount + attemptInvalidCount ||
    attemptPositionCount < acceptedPositionCount ||
    attemptPositionCount > attemptRowCount ||
    legacyPositionCount + postActivationPositionCount !==
      attemptPositionCount ||
    canonicalReplayOutcomeCount !== postActivationPositionCount ||
    attemptTransactionCount < 1 ||
    attemptTransactionCount > attemptPositionCount ||
    mixedOutcomePositionCount > attemptPositionCount ||
    diagnosticRowCount < mixedOutcomePositionCount ||
    segmentCount < 1 ||
    maxCarrierPayloadBytes < 1 ||
    maxCarrierPayloadBytes > 4 * 1024 * 1024 ||
    attemptParity?.canonicalOutcomeHashModel !==
      "proof-id-audit-rolling-sha256-v1" ||
    attemptParity?.canonicalReplayOutcomeHashModel !==
      "proof-id-audit-rolling-sha256-v1" ||
    attemptParity?.coreBoundRelationalRowsHashModel !==
      "proof-id-audit-rolling-sha256-v1" ||
    attemptParity?.relationalRowsHashModel !==
      "proof-id-audit-rolling-sha256-v1" ||
    attemptParity?.transactionTxidsHashModel !==
      "proof-id-audit-rolling-sha256-v1" ||
    !/^[0-9a-f]{64}$/u.test(
      String(attemptParity?.canonicalOutcomeSha256 ?? ""),
    ) ||
    !/^[0-9a-f]{64}$/u.test(
      String(attemptParity?.canonicalReplayOutcomeSha256 ?? ""),
    ) ||
    !/^[0-9a-f]{64}$/u.test(
      String(attemptParity?.coreBoundRelationalRowsSha256 ?? ""),
    ) ||
    !/^[0-9a-f]{64}$/u.test(
      String(attemptParity?.diagnosticSha256 ?? ""),
    ) ||
    !/^[0-9a-f]{64}$/u.test(
      String(attemptParity?.relationalRowsSha256 ?? ""),
    ) ||
    !/^[0-9a-f]{64}$/u.test(
      String(attemptParity?.transactionTxidsSha256 ?? ""),
    )
  ) {
    throw new Error("The exact PWID physical-attempt parity proof is inconsistent.");
  }

  const confirmedTxids = exactTxidSet(
    payload.coverage.confirmedTxids,
    "Confirmed registry coverage",
  );
  const pendingTxids = exactTxidSet(
    payload.coverage.pendingTxids,
    "Pending registry coverage",
  );
  const confirmedTxidCount = exactNonnegativeInteger(
    payload.coverage.confirmedTxidCount,
    "Confirmed registry coverage count",
  );
  const pendingTxidCount = exactNonnegativeInteger(
    payload.coverage.pendingTxidCount,
    "Pending registry coverage count",
  );
  const historyEntryCount = exactNonnegativeInteger(
    payload.coverage.electrumHistoryEntryCount,
    "Electrum registry history count",
  );
  if (
    confirmedTxidCount !== confirmedTxids.length ||
    pendingTxidCount !== pendingTxids.length ||
    historyEntryCount !== confirmedTxids.length + pendingTxids.length ||
    payload.coverage.confirmedTxidsSha256 !== txidSetSha256(confirmedTxids) ||
    payload.coverage.pendingTxidsSha256 !== txidSetSha256(pendingTxids) ||
    !/^[0-9a-f]{64}$/u.test(String(payload.coverage.snapshotSha256 ?? ""))
  ) {
    throw new Error("The internal ID registry audit coverage proof is inconsistent.");
  }

  const checkpointHeight = exactNonnegativeInteger(
    payload.registryProjection?.checkpoint?.height,
    "Registry projection checkpoint height",
  );
  const checkpointHash = exactProjectionTxid(
    payload.registryProjection?.checkpoint?.blockHash,
    "Registry projection checkpoint hash",
  );
  if (checkpointHeight < 1) {
    throw new Error("Registry projection checkpoint is invalid.");
  }
  const confirmedRecords = exactConfirmedProjection(
    payload.registryProjection?.confirmedRecords,
  );
  const pendingRegistryRecords = exactPendingRecordProjection(
    payload.registryProjection?.pendingRecords,
  );
  const pendingEvents = exactPendingEventProjection(
    payload.registryProjection?.pendingEvents,
  );
  const events = exactLifecycleEventProjection(
    payload.registryProjection?.events,
    checkpointHeight,
  );
  const listings = exactLifecycleProjectionArray(
    payload.registryProjection?.listings,
    "Registry listing projection",
  );
  const sales = exactLifecycleProjectionArray(
    payload.registryProjection?.sales,
    "Registry sale projection",
  );
  const projection = {
    checkpoint: { blockHash: checkpointHash, height: checkpointHeight },
    confirmedRecords,
    events,
    listings,
    pendingEvents,
    pendingRecords: pendingRegistryRecords,
    sales,
  };
  const projectionFingerprint = projectionSha256(projection);
  if (
    payload.registryProjection?.projectionSha256 !== projectionFingerprint ||
    payload.coverage?.lifecycleParity?.projectionSha256 !==
      projectionFingerprint
  ) {
    throw new Error("The exact registry projection fingerprint is inconsistent.");
  }
  const confirmedTxidSet = new Set(confirmedTxids);
  if (
    confirmedRecords.some(
      (record) =>
        record.updatedHeight > checkpointHeight ||
        !confirmedTxidSet.has(record.txid) ||
        !confirmedTxidSet.has(record.lastEventTxid),
    )
  ) {
    throw new Error(
      "The confirmed lifecycle projection is outside the exact chain checkpoint or history.",
    );
  }

  const pendingTransactions = Array.isArray(payload.pendingTransactions)
    ? payload.pendingTransactions
    : [];
  const hydratedPendingTxids = exactTxidSet(
    pendingTransactions.map((transaction) => transactionTxid(transaction)),
    "Hydrated pending registry coverage",
  );
  const pendingMempoolTimes = pendingTransactions
    .map((transaction) => {
      const txid = exactProjectionTxid(
        transactionTxid(transaction),
        "Hydrated pending registry transaction",
      );
      const mempoolTime = exactNonnegativeInteger(
        transaction?.status?.mempool_time,
        `Hydrated pending registry transaction ${txid} mempool time`,
      );
      if (mempoolTime < 1) {
        throw new Error(
          `Hydrated pending registry transaction ${txid} has no exact Core mempool time.`,
        );
      }
      return { mempoolTime, txid };
    })
    .sort((left, right) => compareCanonicalUtf8(left.txid, right.txid));
  if (
    pendingTransactions.some(transactionConfirmed) ||
    hydratedPendingTxids.length !== pendingTxids.length ||
    txidSetSha256(hydratedPendingTxids) !== txidSetSha256(pendingTxids) ||
    payload.coverage.pendingObservation.coreMempoolTimeCount !==
      pendingMempoolTimes.length ||
    payload.coverage.pendingObservation.coreMempoolTimeSha256 !==
      projectionSha256(pendingMempoolTimes)
  ) {
    throw new Error("Pending registry transaction hydration is incomplete.");
  }
  const pendingTxidSet = new Set(pendingTxids);
  if (
    [...pendingRegistryRecords, ...pendingEvents].some(
      (item) => !pendingTxidSet.has(item.txid),
    )
  ) {
    throw new Error(
      "The exact pending registry projection is outside the fenced observation.",
    );
  }
  if (confirmedRecords.length < 1 || confirmedTxids.length < 1) {
    throw new Error("The production ID registry audit cannot accept zero confirmed history.");
  }
  const readFence = normalizedRegistryAuditReadFence(
    payload.coverage.readFence,
  );
  if (
    readFence.checkpointHash !== checkpointHash ||
    readFence.checkpointHeight !== checkpointHeight ||
    readFence.confirmedTxidCount !== confirmedTxids.length ||
    readFence.confirmedTxidsSha256 !== txidSetSha256(confirmedTxids) ||
    readFence.pendingTxidCount !== pendingTxids.length ||
    readFence.pendingTxidsSha256 !== txidSetSha256(pendingTxids) ||
    readFence.pendingMempoolTimeSha256 !==
      payload.coverage.pendingObservation.coreMempoolTimeSha256 ||
    readFence.registryProjectionSha256 !== projectionFingerprint ||
    readFence.relationalRowsSha256 !== attemptParity.relationalRowsSha256 ||
    readFence.snapshotSha256 !== payload.coverage.snapshotSha256
  ) {
    throw new Error("The full ID registry audit result disagrees with its read fence.");
  }

  return {
    checkpointHash,
    checkpointHeight,
    confirmedRecords,
    confirmedTxids,
    lifecycleParityVerified: true,
    lifecycleParitySha256: projectionSha256(lifecycleParity),
    canonicalRawReplayBlockCount,
    canonicalRawReplayBlockPaging:
      lifecycleParity.canonicalRawReplayBlockPaging,
    lifecycleEventCount: events.length,
    listingCount: listings.length,
    pendingChanges: pendingEvents.length,
    pendingEvents,
    pendingRecords: pendingRegistryRecords.length,
    pendingRegistryRecords,
    pendingTransactions,
    pendingTxids,
    pendingObservationSha256: projectionSha256(
      payload.coverage.pendingObservation,
    ),
    pwidAttemptPositionCount: attemptPositionCount,
    pwidAttemptParitySha256: projectionSha256(attemptParity),
    pwidDiagnosticRowCount: diagnosticRowCount,
    readFence,
    projectionSha256: projectionFingerprint,
    saleCount: sales.length,
    snapshotSha256: payload.coverage.snapshotSha256,
    statsConfirmed: confirmedRecords.length,
  };
}

async function fetchRegistryAuditCoverage(config) {
  return normalizedRegistryAuditCoverage(
    await fetchJson(
      `${config.apiBase}/api/v1/internal/id-registry-audit?network=${NETWORK}`,
      config,
      0,
      config.coverageTimeoutMs,
    ),
  );
}

async function fetchRegistryAuditReadFence(config) {
  const payload = await fetchJson(
    `${config.apiBase}/api/v1/internal/id-registry-audit-fence?network=${NETWORK}`,
    config,
    0,
    config.coverageTimeoutMs,
  );
  if (payload?.network !== NETWORK) {
    throw new Error("The lightweight ID registry audit fence has the wrong network.");
  }
  return normalizedRegistryAuditReadFence(
    payload.readFence ?? payload.coverage?.readFence,
  );
}

function transactionTxid(tx) {
  return typeof tx.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(tx.txid) ? tx.txid.toLowerCase() : "";
}

function transactionConfirmed(tx) {
  return Boolean(tx.status?.confirmed);
}

function transactionBlockHash(tx) {
  const blockHash = tx.status?.block_hash;
  return typeof blockHash === "string" && /^[0-9a-fA-F]{64}$/u.test(blockHash) ? blockHash.toLowerCase() : "";
}

function transactionBlockHeight(tx) {
  const height = tx.status?.block_height;
  return Number.isSafeInteger(height) && height >= 0 ? height : undefined;
}

function transactionBlockIndex(tx) {
  const index = tx._powBlockIndex ?? tx.status?.block_index ?? tx.status?.block_tx_index;
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

function transactionHasCompleteShape(tx) {
  const vin = Array.isArray(tx?.vin) ? tx.vin : null;
  const vout = Array.isArray(tx?.vout) ? tx.vout : null;
  return Boolean(
    vin &&
      vout &&
      vin.length > 0 &&
      vout.length > 0 &&
      vin.every((input) => {
        if (input?.is_coinbase === true || input?.coinbase) {
          return true;
        }
        const prevout = input?.prevout;
        return Boolean(
          prevout &&
            typeof prevout === "object" &&
            Number.isSafeInteger(Number(prevout.value)) &&
            Number(prevout.value) >= 0 &&
            typeof prevout.scriptpubkey === "string",
        );
      }) &&
      vout.every(
        (output) =>
          Number.isSafeInteger(Number(output?.value)) &&
          Number(output.value) >= 0 &&
          typeof output?.scriptpubkey === "string",
      )
  );
}

function transactionTouchesRegistry(tx) {
  return (
    (Array.isArray(tx?.vout) ? tx.vout : []).some(
      (output) => output?.scriptpubkey_address === REGISTRY_ADDRESS,
    ) ||
    (Array.isArray(tx?.vin) ? tx.vin : []).some(
      (input) => input?.prevout?.scriptpubkey_address === REGISTRY_ADDRESS,
    )
  );
}

function assertExactRegistryTransactionShape(tx) {
  const txid = transactionTxid(tx);
  if (!txid || !transactionHasCompleteShape(tx) || !transactionTouchesRegistry(tx)) {
    throw new Error(
      `Registry transaction ${txid || "(unknown)"} is incompletely hydrated.`,
    );
  }
  if (transactionConfirmed(tx)) {
    if (
      !transactionBlockHash(tx) ||
      !Number.isSafeInteger(transactionBlockHeight(tx)) ||
      transactionBlockHeight(tx) < 1 ||
      !Number.isSafeInteger(Number(tx.status?.block_time)) ||
      Number(tx.status.block_time) < 1
    ) {
      throw new Error(
        `Confirmed registry transaction ${txid} lacks canonical block metadata.`,
      );
    }
  } else if (
    !Number.isSafeInteger(Number(tx.status?.mempool_time)) ||
    Number(tx.status.mempool_time) < 1
  ) {
    throw new Error(
      `Pending registry transaction ${txid} lacks exact mempool time.`,
    );
  }
  return tx;
}

function annotateBlockOrder(txs) {
  for (const tx of txs) {
    assertExactRegistryTransactionShape(tx);
    if (!transactionConfirmed(tx)) {
      continue;
    }
    const txid = transactionTxid(tx);
    const coreIndex = tx?._powBlockIndex;
    const statusIndex = tx?.status?.block_index;
    if (
      !Number.isSafeInteger(coreIndex) ||
      coreIndex < 0 ||
      !Number.isSafeInteger(statusIndex) ||
      statusIndex !== coreIndex
    ) {
      throw new Error(
        `Registry transaction ${txid} has no exact Bitcoin Core block position.`,
      );
    }
  }
  return txs;
}

function assertDescendingChainOrder(transactions, prior = null) {
  let previous = prior;
  for (const transaction of transactions) {
    assertExactRegistryTransactionShape(transaction);
    if (!transactionConfirmed(transaction)) {
      throw new Error("The confirmed registry chain route returned a pending transaction.");
    }
    const current = {
      blockHeight: transactionBlockHeight(transaction),
      blockIndex: transactionBlockIndex(transaction),
      txid: transactionTxid(transaction),
    };
    if (
      !Number.isSafeInteger(current.blockIndex) ||
      (previous &&
        (current.blockHeight > previous.blockHeight ||
          (current.blockHeight === previous.blockHeight &&
            current.blockIndex >= previous.blockIndex)))
    ) {
      throw new Error("The confirmed registry chain route is not in exact descending block order.");
    }
    previous = current;
  }
  return previous;
}

function oldestConfirmedTxid(txs) {
  const confirmedTxs = txs.filter(transactionConfirmed);
  return confirmedTxs.length > 0 ? transactionTxid(confirmedTxs[confirmedTxs.length - 1]) : "";
}

function dedupeTransactions(txs) {
  const merged = new Map();

  for (const tx of txs) {
    const txid = transactionTxid(tx);
    if (!txid) {
      continue;
    }

    const current = merged.get(txid);
    if (!current || (transactionConfirmed(tx) && !transactionConfirmed(current))) {
      merged.set(txid, tx);
    }
  }

  return [...merged.values()];
}

export async function fetchRegistryAuditData(config = auditConfiguration()) {
  const before = await fetchRegistryAuditCoverage(config);
  const chainPage = await fetchAddressTransactionsPage("txs/chain", config);
  if (chainPage.some((transaction) => !transactionConfirmed(transaction))) {
    throw new Error("The confirmed registry chain route returned a pending transaction.");
  }

  const chainTxs = [];
  const chainTxids = new Set();
  let lastChainPosition = null;
  const appendChainPage = (transactions) => {
    lastChainPosition = assertDescendingChainOrder(
      transactions,
      lastChainPosition,
    );
    for (const transaction of transactions) {
      const txid = transactionTxid(transaction);
      if (!txid || !transactionConfirmed(transaction)) {
        throw new Error("The confirmed registry chain route returned an invalid transaction.");
      }
      if (chainTxids.has(txid)) {
        throw new Error(`Registry transaction pagination repeated transaction ${txid}.`);
      }
      chainTxids.add(txid);
      chainTxs.push(transaction);
    }
  };
  appendChainPage(chainPage);

  const cursors = new Set();
  let cursor = oldestConfirmedTxid(chainPage);
  let cursorReads = 0;
  while (cursor) {
    cursorReads += 1;
    if (cursorReads > before.confirmedTxids.length) {
      throw new Error(
        "Registry transaction pagination exceeded the exact observed transaction set.",
      );
    }
    if (cursors.has(cursor)) {
      throw new Error(`Registry transaction pagination repeated cursor ${cursor}.`);
    }

    cursors.add(cursor);
    const nextPage = await fetchAddressTransactionsPage(`txs/chain/${cursor}`, config);
    if (nextPage.length === 0) {
      cursor = "";
      break;
    }

    appendChainPage(nextPage);
    const nextCursor = oldestConfirmedTxid(nextPage);
    if (!nextCursor || nextCursor === cursor) {
      throw new Error("Registry transaction pagination cursor did not advance.");
    }
    cursor = nextCursor;
  }

  const fetchedConfirmedTxids = [...chainTxids].sort();
  if (
    fetchedConfirmedTxids.length !== before.confirmedTxids.length ||
    txidSetSha256(fetchedConfirmedTxids) !== txidSetSha256(before.confirmedTxids)
  ) {
    throw new Error(
      `Confirmed registry history is incomplete: fetched ${fetchedConfirmedTxids.length} of ${before.confirmedTxids.length} Electrum transactions.`,
    );
  }

  const transactions = annotateBlockOrder(
    dedupeTransactions([...chainTxs, ...before.pendingTransactions]),
  );
  const afterFence = await fetchRegistryAuditReadFence(config);
  if (before.readFence.fenceSha256 !== afterFence.fenceSha256) {
    throw new Error("ID registry coverage changed during the audit read.");
  }
  return { coverage: before, transactions };
}

export async function fetchRegistryTransactions(config = auditConfiguration()) {
  return (await fetchRegistryAuditData(config)).transactions;
}

function decodeHex(hex) {
  if (!hex || hex.length % 2 !== 0) {
    return "";
  }

  return Buffer.from(hex, "hex").toString("utf8");
}

function decodedOpReturnMessages(vout) {
  return vout
    .filter((output) => output.scriptpubkey_type === "op_return")
    .map((output) => String(output.scriptpubkey_asm ?? ""))
    .map((asm) =>
      asm
        .split(" ")
        .slice(1)
        .filter((token) => /^[0-9a-fA-F]+$/u.test(token))
        .map(decodeHex)
        .join(""),
    )
    .filter(Boolean);
}

function decodedProtocolMessages(vout, prefix) {
  return decodedOpReturnMessages(vout).filter((message) => message.startsWith(prefix));
}

function firstIdProtocolOutputIndex(vout) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], ID_PROTOCOL_PREFIX).length > 0;
  });
}

function registryPaymentAmount(vout) {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  const total = vout.reduce((sum, output, index) => {
    if (
      output.scriptpubkey_address === REGISTRY_ADDRESS &&
      Number.isSafeInteger(output.value) &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return sum + BigInt(output.value);
    }

    return sum;
  }, 0n);
  return checkedSatsNumber(total, "Registration attempt registry payment");
}

function base64FromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function decodeTextBase64Url(value) {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("Invalid base64url data.");
  }

  return Buffer.from(base64FromBase64Url(value), "base64").toString("utf8");
}

function normalizePowId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "")
    .trim();
}

function isValidBitcoinAddress(address) {
  try {
    bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);
    return true;
  } catch {
    return false;
  }
}

function parseIdRegistrationPayload(payload) {
  let rawId = "";
  let ownerAddress = "";
  let receiveAddress = "";
  let pgpEncoded = "";

  if (payload.startsWith("r2:")) {
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return { error: "bad_r2_field_count" };
    }

    const [, idEncoded, owner, receiver, pgp] = parts;
    try {
      rawId = decodeTextBase64Url(idEncoded);
    } catch {
      return { error: "bad_id_base64url" };
    }

    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else if (payload.startsWith("r:")) {
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return { error: "bad_legacy_field_count" };
    }

    const [, id, owner, receiver, pgp] = parts;
    rawId = id;
    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else {
    return { error: "not_registration_event" };
  }

  const id = normalizePowId(rawId);
  if (!id) {
    return { error: "empty_id" };
  }

  if (!isValidBitcoinAddress(ownerAddress)) {
    return { error: "invalid_owner_address", id };
  }

  if (!isValidBitcoinAddress(receiveAddress)) {
    return { error: "invalid_receive_address", id, ownerAddress };
  }

  let pgpKey = "";
  if (pgpEncoded) {
    try {
      pgpKey = decodeTextBase64Url(pgpEncoded).trim();
    } catch {
      return { error: "bad_pgp_base64url", id, ownerAddress, receiveAddress };
    }
  }

  return {
    id,
    ownerAddress,
    pgpKey,
    receiveAddress,
  };
}

function txCreatedAt(tx) {
  const unixTime = transactionConfirmed(tx)
    ? Number(tx.status?.block_time)
    : Number(tx.status?.mempool_time);
  if (!Number.isSafeInteger(unixTime) || unixTime < 1) {
    throw new Error(
      `Registry transaction ${transactionTxid(tx) || "(unknown)"} has no exact ${transactionConfirmed(tx) ? "block" : "mempool"} time.`,
    );
  }
  return new Date(unixTime * 1000).toISOString();
}

function sortConfirmed(left, right) {
  const leftHeight = Number.isSafeInteger(left.blockHeight) ? left.blockHeight : Number.POSITIVE_INFINITY;
  const rightHeight = Number.isSafeInteger(right.blockHeight) ? right.blockHeight : Number.POSITIVE_INFINITY;
  if (leftHeight !== rightHeight) {
    return leftHeight - rightHeight;
  }

  const leftIndex = Number.isSafeInteger(left.blockIndex) ? left.blockIndex : Number.POSITIVE_INFINITY;
  const rightIndex = Number.isSafeInteger(right.blockIndex) ? right.blockIndex : Number.POSITIVE_INFINITY;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    compareCanonicalUtf8(left.txid, right.txid)
  );
}

function sortPending(left, right) {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    compareCanonicalUtf8(left.txid, right.txid)
  );
}

function inputAddresses(vin) {
  return [
    ...new Set(
      vin
        .map((input) => input?.prevout?.scriptpubkey_address)
        .filter((address) => typeof address === "string" && address.length > 0),
    ),
  ];
}

function likelyRefundAddress(record) {
  if (record.ownerAddress) {
    return record.ownerAddress;
  }

  if (record.inputAddresses.length === 1) {
    return record.inputAddresses[0];
  }

  return record.inputAddresses.join(", ");
}

function extractAuditAttempts(txs) {
  return txs.flatMap((tx) => {
    const txid = transactionTxid(tx);
    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const amountSats = registryPaymentAmount(vout);
    const confirmed = transactionConfirmed(tx);
    const createdAt = txCreatedAt(tx);
    const payerInputAddresses = inputAddresses(vin);
    const blockHeight = transactionBlockHeight(tx);
    const blockIndex = transactionBlockIndex(tx);

    if (!txid || amountSats < ID_REGISTRATION_PRICE_SATS) {
      return [];
    }

    const idPayloads = decodedProtocolMessages(vout, ID_PROTOCOL_PREFIX).map(
      (protocolMessage) => protocolMessage.slice(ID_PROTOCOL_PREFIX.length),
    );
    const registrationCandidates = idPayloads
      .map((payload, index) => ({
        index,
        parsed:
          payload.startsWith("r2:") || payload.startsWith("r:")
            ? parseIdRegistrationPayload(payload)
            : null,
        payload,
      }))
      .filter((candidate) => candidate.parsed !== null);
    const canonicalRegistration = registrationCandidates.find(
      (candidate) => !candidate.parsed.error,
    );
    if (canonicalRegistration && canonicalRegistration.index !== 0) {
      throw new Error(
        `Registry transaction ${txid} has an ambiguous multi-event ID registration envelope.`,
      );
    }

    if (!canonicalRegistration && registrationCandidates.length > 0) {
      if (
        registrationCandidates.length !== 1 ||
        registrationCandidates[0].index !== 0 ||
        idPayloads.length !== 1
      ) {
        throw new Error(
          `Registry transaction ${txid} has an ambiguous malformed ID registration envelope.`,
        );
      }
    }

    if (!canonicalRegistration && registrationCandidates.length === 0) {
      if (idPayloads.length > 0) {
        return [];
      }
      return [
        {
          amountSats,
          blockHeight,
          blockIndex,
          classification: "invalid",
          confirmed,
          createdAt,
          error: "missing_registration_op_return",
          id: "",
          inputAddresses: payerInputAddresses,
          ownerAddress: "",
          pgpKey: "",
          receiveAddress: "",
          refundAddress: payerInputAddresses.length === 1 ? payerInputAddresses[0] : payerInputAddresses.join(", "),
          txid,
        },
      ];
    }

    const parsed =
      canonicalRegistration?.parsed ?? registrationCandidates[0].parsed;
    if (parsed.error) {
      return [
        {
          amountSats,
          blockHeight,
          blockIndex,
          classification: "invalid",
          confirmed,
          createdAt,
          error: parsed.error,
          id: parsed.id ?? "",
          inputAddresses: payerInputAddresses,
          ownerAddress: parsed.ownerAddress ?? "",
          pgpKey: "",
          receiveAddress: parsed.receiveAddress ?? "",
          refundAddress: parsed.ownerAddress ?? (payerInputAddresses.length === 1 ? payerInputAddresses[0] : payerInputAddresses.join(", ")),
          txid,
        },
      ];
    }

    return [
      {
        amountSats,
        blockHeight,
        blockIndex,
        classification: "valid",
        confirmed,
        createdAt,
        error: "",
        id: parsed.id,
        inputAddresses: payerInputAddresses,
        ownerAddress: parsed.ownerAddress,
        pgpKey: parsed.pgpKey,
        receiveAddress: parsed.receiveAddress,
        refundAddress: "",
        txid,
      },
    ];
  });
}

function classifyAttempts(attempts) {
  const valid = attempts.filter((attempt) => attempt.classification === "valid");
  const confirmed = valid.filter((attempt) => attempt.confirmed).sort(sortConfirmed);
  const pending = valid.filter((attempt) => !attempt.confirmed).sort(sortPending);
  const winnersById = new Map();
  const results = [];

  for (const record of confirmed) {
    const winner = winnersById.get(record.id);
    if (!winner) {
      winnersById.set(record.id, record);
      results.push({
        ...record,
        classification: "winner_confirmed",
        refundAddress: "",
        winnerTxid: record.txid,
      });
      continue;
    }

    results.push({
      ...record,
      classification: "duplicate_confirmed_refund_candidate",
      refundAddress: likelyRefundAddress(record),
      winnerTxid: winner.txid,
    });
  }

  const pendingById = new Map();
  for (const record of pending) {
    const winner = winnersById.get(record.id);
    if (winner) {
      results.push({
        ...record,
        classification: "duplicate_pending_watch",
        refundAddress: likelyRefundAddress(record),
        winnerTxid: winner.txid,
      });
      continue;
    }

    const existingPending = pendingById.get(record.id);
    if (!existingPending) {
      pendingById.set(record.id, record);
      results.push({
        ...record,
        classification: "pending_candidate",
        refundAddress: "",
        winnerTxid: "",
      });
      continue;
    }

    results.push({
      ...record,
      classification: "pending_contested_watch",
      refundAddress: likelyRefundAddress(record),
      winnerTxid: existingPending.txid,
    });
  }

  const invalid = attempts
    .filter((attempt) => attempt.classification === "invalid")
    .map((record) => ({
      ...record,
      classification: record.confirmed ? "invalid_confirmed_refund_candidate" : "invalid_pending_watch",
      winnerTxid: "",
    }));

  return [...results, ...invalid];
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/u.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(records) {
  const headers = [
    "classification",
    "id",
    "amountSats",
    "confirmed",
    "createdAt",
    "txid",
    "winnerTxid",
    "ownerAddress",
    "receiveAddress",
    "refundAddress",
    "inputAddresses",
    "error",
  ];
  const rows = records.map((record) =>
    headers
      .map((header) => {
        const value = header === "inputAddresses" ? record.inputAddresses.join(" ") : record[header];
        return csvEscape(value);
      })
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function printSection(title, records) {
  console.log(`\n${title}: ${records.length}`);
  for (const record of records) {
    console.log(
      [
        `- ${record.id || "(unknown id)"}`,
        record.classification,
        `${record.amountSats} sats`,
        record.confirmed ? "confirmed" : "pending",
        record.txid,
        record.refundAddress ? `refund: ${record.refundAddress}` : "",
        record.winnerTxid && record.winnerTxid !== record.txid ? `winner: ${record.winnerTxid}` : "",
        record.error ? `error: ${record.error}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
}

function summarizeByRefundAddress(records) {
  const totals = new Map();

  for (const record of records) {
    if (!record.refundAddress) {
      continue;
    }

    const current = totals.get(record.refundAddress) ?? {
      address: record.refundAddress,
      ids: [],
      sats: 0n,
      txids: [],
    };
    current.ids.push(record.id || "(unknown id)");
    current.sats += BigInt(
      exactNonnegativeInteger(
        record.amountSats,
        `Refund candidate ${record.txid} amount`,
      ),
    );
    current.txids.push(record.txid);
    totals.set(record.refundAddress, current);
  }

  return [...totals.values()]
    .sort((left, right) =>
      left.sats === right.sats
        ? compareCanonicalUtf8(left.address, right.address)
        : left.sats > right.sats
          ? -1
          : 1,
    )
    .map((total) => ({
      ...total,
      sats: checkedSatsNumber(
        total.sats,
        `Refund total for ${total.address}`,
      ),
    }));
}

function printRefundTotals(title, totals) {
  console.log(`\n${title}: ${totals.length}`);
  for (const total of totals) {
    console.log(`- ${total.address} | ${total.sats} sats | ${total.txids.length} txs | IDs: ${total.ids.join(", ")}`);
  }
}

export function buildAuditResult(txs, auditedAt = new Date().toISOString()) {
  const attempts = extractAuditAttempts(txs);
  const classified = classifyAttempts(attempts);
  const refundCandidates = classified.filter((record) => record.classification.endsWith("_refund_candidate"));
  const pendingWatch = classified.filter((record) => record.classification.endsWith("_watch"));
  const winners = classified.filter((record) => record.classification === "winner_confirmed");
  const pendingCandidates = classified.filter((record) => record.classification === "pending_candidate");
  return {
    allClassifiedAttempts: classified,
    auditedAt,
    network: NETWORK,
    pendingCandidates,
    pendingWatch,
    pendingWatchTotalsByAddress: summarizeByRefundAddress(pendingWatch),
    refundCandidates,
    refundTotalsByAddress: summarizeByRefundAddress(refundCandidates),
    registryAddress: REGISTRY_ADDRESS,
    totals: {
      fetchedTransactions: txs.length,
      registrationAttempts: attempts.length,
      winners: winners.length,
      pendingCandidates: pendingCandidates.length,
      refundCandidates: refundCandidates.length,
      pendingWatch: pendingWatch.length,
    },
    winners,
  };
}

export function assertAuditMatchesCoverage(result, coverage) {
  if (result.totals.winners !== coverage.statsConfirmed) {
    throw new Error(
      `Confirmed ID winner count mismatch: audit=${result.totals.winners}, registry=${coverage.statsConfirmed}.`,
    );
  }
  if (result.totals.pendingCandidates !== coverage.pendingRecords) {
    throw new Error(
      `Pending ID record count mismatch: audit=${result.totals.pendingCandidates}, registry=${coverage.pendingRecords}.`,
    );
  }
  const confirmedById = new Map(
    coverage.confirmedRecords.map((record) => [record.id, record]),
  );
  for (const winner of result.winners) {
    const projected = confirmedById.get(winner.id);
    if (
      !projected ||
      projected.txid !== winner.txid ||
      projected.blockHeight !== winner.blockHeight ||
      projected.blockIndex !== winner.blockIndex
    ) {
      throw new Error(
        `Confirmed ID identity mismatch for ${winner.id}: audit and exact relational projection disagree.`,
      );
    }
  }
  const pendingAuditProjection = result.pendingCandidates
    .map((record) => ({
      id: record.id,
      ownerAddress: record.ownerAddress,
      pgpKey: record.pgpKey ?? "",
      receiveAddress: record.receiveAddress,
      txid: record.txid,
    }))
    .sort(
      (left, right) =>
        compareCanonicalUtf8(left.id, right.id) ||
        compareCanonicalUtf8(left.txid, right.txid),
    );
  if (
    canonicalAuditJson(pendingAuditProjection) !==
    canonicalAuditJson(coverage.pendingRegistryRecords)
  ) {
    throw new Error(
      "Pending ID identities disagree with the exact relational projection.",
    );
  }
  if (
    coverage.pendingChanges !== coverage.pendingEvents.length ||
    coverage.pendingEvents.some(
      (event) => !coverage.pendingTxids.includes(event.txid),
    )
  ) {
    throw new Error(
      "Pending ID mutation identities are outside the fenced observation.",
    );
  }
  return true;
}

function outputDirectory(argv, env) {
  const index = argv.indexOf("--output-dir");
  if (index !== -1) {
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error("--output-dir requires a directory path.");
    }
    return resolve(argv[index + 1]);
  }
  return env.POW_ID_AUDIT_OUTPUT_DIR ? resolve(env.POW_ID_AUDIT_OUTPUT_DIR) : "";
}

function reportsRequested(argv, env) {
  return argv.includes("--write-reports") || booleanSetting(env, "POW_ID_AUDIT_WRITE_REPORTS", false);
}

export async function runAudit({ argv = [], env = process.env } = {}) {
  const config = auditConfiguration(env);
  const { coverage, transactions } = await fetchRegistryAuditData(config);
  const result = buildAuditResult(transactions);
  assertAuditMatchesCoverage(result, coverage);
  const directory = outputDirectory(argv, env);
  const writeReports = reportsRequested(argv, env);
  if (writeReports && !directory) {
    throw new Error("Report writing requires an explicit --output-dir PATH or POW_ID_AUDIT_OUTPUT_DIR.");
  }
  let csvPath = "";
  let jsonPath = "";
  if (writeReports && directory) {
    const timestamp = result.auditedAt.replace(/[:.]/g, "-");
    jsonPath = resolve(directory, `proofofwork-id-registry-audit-${timestamp}.json`);
    csvPath = resolve(directory, `proofofwork-id-registry-audit-${timestamp}.csv`);
    await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    await writeFile(
      csvPath,
      `${toCsv([...result.refundCandidates, ...result.pendingWatch, ...result.pendingCandidates, ...result.winners])}\n`,
      { flag: "wx" },
    );
  }

  console.log("ProofOfWork ID registry audit");
  console.log(`Address source: ${config.addressApiBase}`);
  console.log(`Registry: ${REGISTRY_ADDRESS}`);
  console.log(`Fetched transactions: ${result.totals.fetchedTransactions}`);
  console.log(`Covered confirmed registry transactions: ${coverage.confirmedTxids.length}`);
  console.log(`Covered pending registry transactions: ${coverage.pendingTxids.length}`);
  console.log("Canonical lifecycle parity: verified against exact Core-ordered chain replay");
  console.log(`Lifecycle events: ${coverage.lifecycleEventCount}`);
  console.log(`Active listings: ${coverage.listingCount}`);
  console.log(`Canonical sales: ${coverage.saleCount}`);
  console.log(`Registration attempts: ${result.totals.registrationAttempts}`);
  console.log(`Confirmed winners: ${result.totals.winners}`);
  console.log(`Pending candidates: ${result.totals.pendingCandidates}`);
  console.log(`Refund candidates: ${result.totals.refundCandidates}`);
  console.log(`Pending watchlist: ${result.totals.pendingWatch}`);
  printSection("Refund candidates", result.refundCandidates);
  printRefundTotals("Refund totals by address", result.refundTotalsByAddress);
  printSection("Pending watchlist", result.pendingWatch);
  printRefundTotals("Pending watch totals by address", result.pendingWatchTotalsByAddress);
  if (writeReports && directory) {
    console.log(`\nJSON report: ${jsonPath}`);
    console.log(`CSV report: ${csvPath}`);
  } else {
    console.log("\nNo report files written (use --write-reports and --output-dir PATH to opt in). ");
  }
  return { config, csvPath, jsonPath, result };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  await runAudit({ argv: process.argv.slice(2) });
}
