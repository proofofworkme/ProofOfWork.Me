import { createHash } from "node:crypto";

import {
  WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
} from "./work-amo-v5-raw.mjs";

const HEX_32_PATTERN = /^[0-9a-f]{64}$/u;
const SCRIPT_HEX_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const WITNESS_COMMITMENT_PREFIX = "6a24aa21a9ed";
const LEGACY_WITNESS_KEYS = [
  "commitmentSha256",
  "commitmentVout",
  "model",
  "required",
  "witnessMerkleRootInternalHex",
  "witnessTransactionCount",
];
const REQUIRED_WITNESS_KEYS = [
  "coinbaseWitnessReservedValueHex",
  "commitmentScriptPubKeyHex",
  ...LEGACY_WITNESS_KEYS,
].sort();

function hasExactOwnKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function doubleSha256Hex(bytes) {
  const first = createHash("sha256").update(bytes).digest();
  return createHash("sha256").update(first).digest("hex");
}

export function normalizedWorkAmoV5Bip141Witness(
  value,
  blockTransactionCount = undefined,
) {
  const blockTransactionCountProvided =
    blockTransactionCount !== undefined;
  const exactBlockTransactionCount = blockTransactionCount;
  if (
    (
      blockTransactionCountProvided &&
      (
        typeof exactBlockTransactionCount !== "number" ||
        !Number.isSafeInteger(exactBlockTransactionCount) ||
        exactBlockTransactionCount < 1
      )
    ) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.model !== WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL ||
    typeof value.required !== "boolean"
  ) {
    return null;
  }
  const witnessTransactionCount = value.witnessTransactionCount;
  if (
    typeof witnessTransactionCount !== "number" ||
    !Number.isSafeInteger(witnessTransactionCount) ||
    witnessTransactionCount < 0
  ) {
    return null;
  }
  const commitmentSha256 = value.commitmentSha256;
  const witnessMerkleRootInternalHex =
    value.witnessMerkleRootInternalHex;
  if (value.required === false) {
    return hasExactOwnKeys(value, LEGACY_WITNESS_KEYS) &&
      typeof commitmentSha256 === "string" &&
      typeof witnessMerkleRootInternalHex === "string" &&
      witnessTransactionCount === 0 &&
      value.commitmentVout === null &&
      commitmentSha256 === "" &&
      witnessMerkleRootInternalHex === ""
      ? {
          commitmentSha256: "",
          commitmentVout: null,
          model: WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
          required: false,
          witnessMerkleRootInternalHex: "",
          witnessTransactionCount: 0,
        }
      : null;
  }
  const commitmentVout = value.commitmentVout;
  const commitmentScriptPubKeyHex =
    value.commitmentScriptPubKeyHex;
  const coinbaseWitnessReservedValueHex =
    value.coinbaseWitnessReservedValueHex;
  if (
    !hasExactOwnKeys(value, REQUIRED_WITNESS_KEYS) ||
    witnessTransactionCount < 1 ||
    (
      blockTransactionCountProvided &&
      witnessTransactionCount > exactBlockTransactionCount
    ) ||
    typeof commitmentVout !== "number" ||
    !Number.isSafeInteger(commitmentVout) ||
    commitmentVout < 0 ||
    typeof commitmentSha256 !== "string" ||
    typeof witnessMerkleRootInternalHex !== "string" ||
    typeof coinbaseWitnessReservedValueHex !== "string" ||
    typeof commitmentScriptPubKeyHex !== "string" ||
    !HEX_32_PATTERN.test(commitmentSha256) ||
    !HEX_32_PATTERN.test(witnessMerkleRootInternalHex) ||
    !HEX_32_PATTERN.test(coinbaseWitnessReservedValueHex) ||
    !SCRIPT_HEX_PATTERN.test(commitmentScriptPubKeyHex) ||
    !commitmentScriptPubKeyHex.startsWith(
      WITNESS_COMMITMENT_PREFIX,
    ) ||
    commitmentScriptPubKeyHex.length < 76 ||
    commitmentScriptPubKeyHex.slice(12, 76) !== commitmentSha256 ||
    doubleSha256Hex(
      Buffer.concat([
        Buffer.from(witnessMerkleRootInternalHex, "hex"),
        Buffer.from(coinbaseWitnessReservedValueHex, "hex"),
      ]),
    ) !== commitmentSha256
  ) {
    return null;
  }
  return {
    coinbaseWitnessReservedValueHex,
    commitmentScriptPubKeyHex,
    commitmentSha256,
    commitmentVout,
    model: WORK_AMO_V5_RAW_BIP141_WITNESS_MODEL,
    required: true,
    witnessMerkleRootInternalHex,
    witnessTransactionCount,
  };
}

export function workAmoV5Bip141WitnessesEqual(
  left,
  right,
  blockTransactionCount = undefined,
) {
  const normalizedLeft = normalizedWorkAmoV5Bip141Witness(
    left,
    blockTransactionCount,
  );
  const normalizedRight = normalizedWorkAmoV5Bip141Witness(
    right,
    blockTransactionCount,
  );
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      JSON.stringify(normalizedLeft) ===
        JSON.stringify(normalizedRight),
  );
}
