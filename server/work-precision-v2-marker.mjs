import { createHash } from "node:crypto";

import { compareCanonicalUtf8 } from "./canonical-order.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_PRECISION_V2_MIGRATION_MODEL,
  WORK_PRECISION_V2_MODEL,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
} from "./work-units.mjs";
import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
} from "./work-amo-v5.mjs";
import {
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
} from "./work-amo-v6.mjs";
import {
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V8_RELIC_CUTOVER_MODEL,
  WORK_AMO_V8_TRANSFER_VERSION,
} from "./work-amo-v8.mjs";
import {
  workAmoV8DeclarationCommitment,
} from "./work-amo-v8-declaration.mjs";

const EVIDENCE_MODEL =
  "canonical-work-precision-v2-declaration-core-index-evidence-v1";
const EVIDENCE_DOMAIN =
  "ProofOfWork.Me/WORK-PRECISION-V2-DECLARATION-EVIDENCE/v1";
const SNAPSHOT_POLICY =
  "preserve-preactivation-canonical-invalidate-wrong-era-derived-require-post-migration-current-snapshot";
const DERIVED_POLICY = "invalidate-and-replay-from-activation";
const RAW_HISTORY_POLICY = "none";
const CONVERSION_FACTOR = "100000000";

const MARKER_KEYS = Object.freeze([
  "activationHeight",
  "activationOpening",
  "after",
  "before",
  "completedAt",
  "conversionFactor",
  "declarationBlockHash",
  "declarationBlockIndex",
  "declarationEvidence",
  "declarationHeight",
  "declarationMemoBytes",
  "declarationMemoSha256",
  "declarationProtocolVout",
  "declarationRecordOrdinal",
  "declarationRegistryPaymentVout",
  "declarationTextBytes",
  "declarationTextSha256",
  "declarationTxid",
  "decimals",
  "derivedProjectionPolicy",
  "globalPrecisionModel",
  "legacyDecimals",
  "legacyProjectionModel",
  "maxSupplySubatoms",
  "migrationModel",
  "mintAmountSubatoms",
  "model",
  "network",
  "projectionModel",
  "rawConfirmedHistoryMutation",
  "relicCutover",
  "replayFromHeight",
  "snapshotPolicy",
  "status",
  "transferVersion",
  "unitScale",
  "updatedAt",
  "version",
]);

const EVIDENCE_KEYS = Object.freeze([
  "authorityScriptPubKey",
  "blockHash",
  "blockHeight",
  "blockTransactionIndex",
  "commitmentSha256",
  "coreVerified",
  "evidenceComplete",
  "indexVerified",
  "inputCount",
  "model",
  "outputCount",
  "payloadBytes",
  "payloadSha256",
  "protocol",
  "protocolVout",
  "recordOrdinal",
  "registryAddress",
  "registryPaymentSats",
  "registryPaymentVout",
  "txid",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function exactKeys(value, expected) {
  const actual = Object.keys(record(value)).sort(compareCanonicalUtf8);
  const wanted = [...expected].sort(compareCanonicalUtf8);
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function jsonInteger(value, minimum = 0) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  );
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${
      Object.keys(value)
        .sort(compareCanonicalUtf8)
        .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value ?? null);
}

function commitmentReady(value, { model = "" } = {}) {
  const commitment = record(value);
  return (
    (!model || exactKeys(commitment, ["model", "payloadBytes", "sha256"])) &&
    (!model || commitment.model === model) &&
    jsonInteger(commitment.payloadBytes, 1) &&
    /^[0-9a-f]{64}$/u.test(String(commitment.sha256 ?? "")) &&
    commitment.sha256 === lower(commitment.sha256)
  );
}

function rowsCommitmentReady(value) {
  const commitment = record(value);
  return (
    exactKeys(commitment, ["count", "payloadBytes", "sha256"]) &&
    jsonInteger(commitment.count) &&
    commitmentReady(commitment)
  );
}

export function workPrecisionV2RelicCutoverReady(value) {
  const cutover = record(value);
  const items = Array.isArray(cutover.items) ? cutover.items : null;
  if (
    !items ||
    !exactKeys(cutover, [
      "count",
      "items",
      "model",
      "payloadBytes",
      "sha256",
    ]) ||
    cutover.model !== WORK_AMO_V8_RELIC_CUTOVER_MODEL ||
    !jsonInteger(cutover.count) ||
    cutover.count !== items.length
  ) {
    return false;
  }
  let previousListingId = "";
  for (const rawItem of items) {
    const item = record(rawItem);
    const listingId = String(item.listingId ?? "");
    const sellerAddress = String(item.sellerAddress ?? "");
    if (
      !exactKeys(item, [
        "amountAtoms",
        "listingId",
        "priceSats",
        "sellerAddress",
      ]) ||
      !/^[1-9][0-9]*$/u.test(String(item.amountAtoms ?? "")) ||
      !/^[0-9a-f]{64}$/u.test(listingId) ||
      !/^[1-9][0-9]*$/u.test(String(item.priceSats ?? "")) ||
      !sellerAddress ||
      sellerAddress !== sellerAddress.trim() ||
      sellerAddress.length > 128 ||
      (previousListingId &&
        compareCanonicalUtf8(previousListingId, listingId) >= 0)
    ) {
      return false;
    }
    previousListingId = listingId;
  }
  const payload = stableJson(items);
  return (
    cutover.payloadBytes === Buffer.byteLength(payload, "utf8") &&
    cutover.sha256 ===
      createHash("sha256")
        .update(Buffer.from(payload, "utf8"))
        .digest("hex")
  );
}

function evidenceCommitment(evidenceValue) {
  const evidence = record(evidenceValue);
  const committed = {
    authorityScriptPubKey: lower(evidence.authorityScriptPubKey),
    blockHash: lower(evidence.blockHash),
    blockHeight: Number(evidence.blockHeight),
    blockTransactionIndex: Number(evidence.blockTransactionIndex),
    inputCount: Number(evidence.inputCount),
    outputCount: Number(evidence.outputCount),
    payloadBytes: Number(evidence.payloadBytes),
    payloadSha256: lower(evidence.payloadSha256),
    protocol: String(evidence.protocol ?? ""),
    protocolVout: Number(evidence.protocolVout),
    recordOrdinal: Number(evidence.recordOrdinal),
    registryAddress: String(evidence.registryAddress ?? "").trim(),
    registryPaymentSats: String(evidence.registryPaymentSats ?? "").trim(),
    registryPaymentVout: Number(evidence.registryPaymentVout),
    txid: lower(evidence.txid),
  };
  return {
    committed,
    sha256: createHash("sha256")
      .update(Buffer.from(`${EVIDENCE_DOMAIN}\n${JSON.stringify(committed)}`, "utf8"))
      .digest("hex"),
  };
}

export function workPrecisionV2MarkerReady(
  markerValue,
  pinsValue,
  { network = "livenet" } = {},
) {
  const marker = record(markerValue);
  const pins = record(pinsValue);
  const evidence = record(marker.declarationEvidence);
  const activationOpening = record(marker.activationOpening);
  const before = record(marker.before);
  const after = record(marker.after);
  const evidenceHash = evidenceCommitment(evidence);
  let declaration;
  try {
    declaration = workAmoV8DeclarationCommitment();
  } catch {
    return false;
  }
  return Boolean(
    exactKeys(marker, MARKER_KEYS) &&
      Number.isSafeInteger(pins.declarationHeight) &&
      pins.declarationHeight > 0 &&
      pins.activationHeight === pins.declarationHeight + 1 &&
      /^[0-9a-f]{64}$/u.test(String(pins.declarationTxid ?? "")) &&
      /^[0-9a-f]{64}$/u.test(
        String(pins.declarationBlockHash ?? ""),
      ) &&
      pins.declarationMemoBytes === declaration.protocolRecordBytes &&
      pins.declarationMemoSha256 === declaration.protocolRecordSha256 &&
      exactKeys(activationOpening, [
        "declarationClosingStatePayloadBytes",
        "declarationClosingStateSha256",
        "declarationTransitionModel",
        "legacyTokenStateCommitment",
        "subatomTokenStateCommitment",
      ]) &&
      exactKeys(before, ["balances", "listings"]) &&
      exactKeys(after, ["balances", "listings"]) &&
      exactKeys(evidence, EVIDENCE_KEYS) &&
      marker.model === WORK_PRECISION_V2_MIGRATION_MODEL &&
      marker.migrationModel === WORK_PRECISION_V2_MIGRATION_MODEL &&
      marker.status === "complete" &&
      marker.network === network &&
      marker.version === WORK_AMO_V8_AUTH_VERSION &&
      marker.globalPrecisionModel === WORK_PRECISION_V2_MODEL &&
      marker.projectionModel === WORK_SUBATOM_PROJECTION_MODEL &&
      marker.legacyProjectionModel === WORK_ATOMIC_PROJECTION_MODEL &&
      marker.transferVersion === WORK_AMO_V8_TRANSFER_VERSION &&
      marker.legacyDecimals === WORK_DECIMALS &&
      marker.decimals === WORK_SUBATOM_DECIMALS &&
      String(marker.conversionFactor ?? "") === CONVERSION_FACTOR &&
      String(marker.unitScale ?? "") === WORK_SUBATOM_UNIT_SCALE_TEXT &&
      String(marker.maxSupplySubatoms ?? "") ===
        WORK_AMO_V8_MAX_SUPPLY_SUBATOMS.toString() &&
      String(marker.mintAmountSubatoms ?? "") ===
        WORK_AMO_V8_MINT_AMOUNT_SUBATOMS.toString() &&
      marker.rawConfirmedHistoryMutation === RAW_HISTORY_POLICY &&
      marker.derivedProjectionPolicy === DERIVED_POLICY &&
      marker.snapshotPolicy === SNAPSHOT_POLICY &&
      marker.activationHeight === pins.activationHeight &&
      marker.replayFromHeight === pins.activationHeight &&
      marker.declarationTxid === pins.declarationTxid &&
      marker.declarationHeight === pins.declarationHeight &&
      marker.declarationBlockHash === pins.declarationBlockHash &&
      marker.declarationBlockIndex === pins.declarationBlockIndex &&
      marker.declarationMemoBytes === pins.declarationMemoBytes &&
      marker.declarationMemoSha256 === pins.declarationMemoSha256 &&
      marker.declarationProtocolVout === pins.declarationProtocolVout &&
      marker.declarationRecordOrdinal === pins.declarationRecordOrdinal &&
      marker.declarationRegistryPaymentVout ===
        pins.declarationRegistryPaymentVout &&
      marker.declarationTextBytes === declaration.payloadBytes &&
      marker.declarationTextSha256 === declaration.payloadSha256 &&
      Number.isFinite(Date.parse(String(marker.completedAt ?? ""))) &&
      Number.isFinite(Date.parse(String(marker.updatedAt ?? ""))) &&
      activationOpening.declarationTransitionModel ===
        WORK_AMO_V6_BLOCK_SEQUENCER_MODEL &&
      jsonInteger(
        activationOpening.declarationClosingStatePayloadBytes,
        1,
      ) &&
      /^[0-9a-f]{64}$/u.test(
        lower(activationOpening.declarationClosingStateSha256),
      ) &&
      commitmentReady(activationOpening.legacyTokenStateCommitment, {
        model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      }) &&
      commitmentReady(activationOpening.subatomTokenStateCommitment, {
        model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      }) &&
      rowsCommitmentReady(before.balances) &&
      rowsCommitmentReady(before.listings) &&
      rowsCommitmentReady(after.balances) &&
      rowsCommitmentReady(after.listings) &&
      workPrecisionV2RelicCutoverReady(marker.relicCutover) &&
      evidence.model === EVIDENCE_MODEL &&
      evidence.coreVerified === true &&
      evidence.indexVerified === true &&
      evidence.evidenceComplete === true &&
      evidence.commitmentSha256 === evidenceHash.sha256 &&
      jsonInteger(evidence.blockHeight, 1) &&
      jsonInteger(evidence.blockTransactionIndex) &&
      jsonInteger(evidence.inputCount, 1) &&
      jsonInteger(evidence.outputCount, 1) &&
      jsonInteger(evidence.payloadBytes, 1) &&
      jsonInteger(evidence.protocolVout) &&
      jsonInteger(evidence.recordOrdinal) &&
      jsonInteger(evidence.registryPaymentVout) &&
      evidence.authorityScriptPubKey === lower(evidence.authorityScriptPubKey) &&
      evidence.blockHash === lower(evidence.blockHash) &&
      evidence.payloadSha256 === lower(evidence.payloadSha256) &&
      evidence.txid === lower(evidence.txid) &&
      evidence.registryAddress === String(evidence.registryAddress ?? "").trim() &&
      evidence.registryPaymentSats === String(evidence.registryPaymentSats ?? "").trim() &&
      evidenceHash.committed.authorityScriptPubKey ===
        WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY &&
      evidenceHash.committed.txid === pins.declarationTxid &&
      evidenceHash.committed.blockHash === pins.declarationBlockHash &&
      evidenceHash.committed.blockHeight === pins.declarationHeight &&
      evidenceHash.committed.blockTransactionIndex ===
        pins.declarationBlockIndex &&
      evidenceHash.committed.payloadBytes === pins.declarationMemoBytes &&
      evidenceHash.committed.payloadSha256 === pins.declarationMemoSha256 &&
      evidenceHash.committed.protocol === "pwm1" &&
      evidenceHash.committed.protocolVout === pins.declarationProtocolVout &&
      evidenceHash.committed.recordOrdinal === pins.declarationRecordOrdinal &&
      evidenceHash.committed.registryAddress ===
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS &&
      /^[1-9][0-9]*$/u.test(evidenceHash.committed.registryPaymentSats) &&
      BigInt(evidenceHash.committed.registryPaymentSats) >=
        BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS) &&
      evidenceHash.committed.registryPaymentVout ===
        pins.declarationRegistryPaymentVout
  );
}
