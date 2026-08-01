import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
} from "./work-amo-v5.mjs";
import {
  workAmoV8DeclarationCommitment,
} from "./work-amo-v8-declaration.mjs";

export const WORK_AMO_V8_ACTIVATION_LATCH_META_KEY =
  "workAmoV8ActivationLatch:livenet";
export const WORK_AMO_V8_ACTIVATION_LATCH_MODEL =
  "canonical-work-amo-v8-activation-latch-v1";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function exactKeys(value, expected) {
  const actual = Object.keys(record(value)).sort();
  const wanted = [...expected].sort();
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

export function workAmoV8ActivationLatchReady(
  latchValue,
  pinsValue,
  { network = "livenet" } = {},
) {
  const latch = record(latchValue);
  const pins = record(pinsValue);
  const registryPaymentSats = String(
    latch.registryPaymentSats ?? "",
  );
  let declaration;
  try {
    declaration = workAmoV8DeclarationCommitment();
  } catch {
    return false;
  }
  return Boolean(
    exactKeys(latch, [
      "activationHeight",
      "authorityScriptPubKey",
      "coreVerified",
      "declarationBlockHash",
      "declarationBlockIndex",
      "declarationHeight",
      "declarationMemoBytes",
      "declarationMemoSha256",
      "declarationProtocolVout",
      "declarationRecordOrdinal",
      "declarationRegistryPaymentVout",
      "declarationTxid",
      "evidenceComplete",
      "firstObservedTipHash",
      "firstObservedTipHeight",
      "indexVerified",
      "inputCount",
      "model",
      "network",
      "observedAt",
      "outputCount",
      "protocol",
      "reached",
      "registryAddress",
      "registryPaymentSats",
    ]) &&
      latch.model === WORK_AMO_V8_ACTIVATION_LATCH_MODEL &&
      latch.network === network &&
      latch.reached === true &&
      Number.isSafeInteger(pins.declarationHeight) &&
      pins.declarationHeight > 0 &&
      pins.activationHeight === pins.declarationHeight + 1 &&
      /^[0-9a-f]{64}$/u.test(String(pins.declarationTxid ?? "")) &&
      /^[0-9a-f]{64}$/u.test(
        String(pins.declarationBlockHash ?? ""),
      ) &&
      pins.declarationMemoBytes === declaration.protocolRecordBytes &&
      pins.declarationMemoSha256 === declaration.protocolRecordSha256 &&
      latch.activationHeight === pins.activationHeight &&
      latch.declarationTxid === pins.declarationTxid &&
      latch.declarationHeight === pins.declarationHeight &&
      latch.declarationBlockHash === pins.declarationBlockHash &&
      latch.declarationBlockIndex === pins.declarationBlockIndex &&
      latch.declarationMemoBytes === pins.declarationMemoBytes &&
      latch.declarationMemoSha256 === pins.declarationMemoSha256 &&
      latch.declarationProtocolVout === pins.declarationProtocolVout &&
      latch.declarationRecordOrdinal === pins.declarationRecordOrdinal &&
      latch.declarationRegistryPaymentVout ===
        pins.declarationRegistryPaymentVout &&
      latch.authorityScriptPubKey ===
        WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY &&
      latch.protocol === "pwm1" &&
      String(latch.registryAddress ?? "").trim() ===
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS &&
      typeof latch.registryPaymentSats === "string" &&
      registryPaymentSats === registryPaymentSats.trim() &&
      /^(?:0|[1-9][0-9]*)$/u.test(registryPaymentSats) &&
      BigInt(registryPaymentSats) >=
        BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS) &&
      jsonInteger(latch.inputCount, 1) &&
      jsonInteger(latch.outputCount, 1) &&
      latch.coreVerified === true &&
      latch.indexVerified === true &&
      latch.evidenceComplete === true &&
      jsonInteger(latch.firstObservedTipHeight, pins.activationHeight) &&
      latch.firstObservedTipHeight === pins.activationHeight &&
      /^[0-9a-f]{64}$/u.test(
        String(latch.firstObservedTipHash ?? ""),
      ) &&
      Number.isFinite(Date.parse(String(latch.observedAt ?? "")))
  );
}
