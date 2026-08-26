const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/u;

export const CANONICAL_PROTOCOL_PREFIXES = Object.freeze([
  "pwm1:",
  "pwa1:",
  "pwid1:",
  "pwt1:",
]);

export const CANONICAL_OP_RETURN_SCRIPT_MALFORMED =
  "work-amo-v5-raw-op-return-script-malformed";
export const CANONICAL_OP_RETURN_UTF8_INVALID =
  "work-amo-v5-raw-op-return-utf8-invalid";
export const CANONICAL_OP_RETURN_TEXT_STORAGE_INVALID =
  "work-amo-v5-raw-op-return-text-storage-invalid";
export const CANONICAL_PWM_ENVELOPE_NONCONTIGUOUS =
  "work-amo-v5-raw-pwm-envelope-noncontiguous";

const PREFIX_BYTES = CANONICAL_PROTOCOL_PREFIXES.map((prefix) => ({
  bytes: Buffer.from(prefix, "ascii"),
  prefix,
}));

/**
 * Remove PostgreSQL-unrepresentable U+0000 strings from a JSON projection.
 *
 * This is only a persistence adapter; canonical byte evidence must live in
 * payloadHex/scriptPubKeyHex before this is used. Invalid string values become
 * null and invalid object keys are omitted deterministically. Valid values are
 * preserved byte-for-byte.
 */
export function canonicalPostgresSafeJsonValue(value) {
  if (typeof value === "string") {
    return value.includes("\u0000") ? null : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalPostgresSafeJsonValue(entry));
  }
  if (
    !value ||
    typeof value !== "object" ||
    (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
  ) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.includes("\u0000"))
      .map(([key, entry]) => [
        key,
        canonicalPostgresSafeJsonValue(entry),
      ]),
  );
}

function exactScriptPubKeyHex(output) {
  const source = String(
    output?.scriptPubKeyHex ??
      output?.scriptPubKey?.hex ??
      output?.scriptpubkey ??
      "",
  ).trim();
  return HEX_PATTERN.test(source.toLowerCase())
    ? source.toLowerCase()
    : "";
}

function governedPrefix(payload) {
  for (const candidate of PREFIX_BYTES) {
    if (
      payload.length >= candidate.bytes.length &&
      payload.subarray(0, candidate.bytes.length)
        .equals(candidate.bytes)
    ) {
      return candidate.prefix;
    }
  }
  return "";
}

function malformedCandidate(scriptPubKeyHex, chunks, detail) {
  const payload = Buffer.concat(chunks);
  const prefix = governedPrefix(payload);
  return {
    candidate: Boolean(prefix),
    decodeValid: false,
    detail,
    payloadHex: payload.toString("hex"),
    prefix,
    reasonCode: CANONICAL_OP_RETURN_SCRIPT_MALFORMED,
    scriptPubKeyHex,
    text: prefix,
  };
}

/**
 * Decode one exact scriptPubKey-hex nulldata program.
 *
 * The script bytes are the only authority. ASM and script type are ignored.
 * Every byte after OP_RETURN must be consumed by OP_0 or PUSHDATA 1/2/4.
 * Successful chunks are concatenated and decoded as fatal UTF-8. Decoded text
 * containing U+0000 is storage-invalid because PostgreSQL text/jsonb cannot
 * represent it. On either failure, already available pushed bytes are retained
 * only as immutable evidence and for byte-level governed-prefix classification;
 * partial or storage-invalid text is never parsed or returned.
 */
export function decodeCanonicalOpReturnOutput(output) {
  const scriptPubKeyHex = exactScriptPubKeyHex(output);
  if (!scriptPubKeyHex) {
    return {
      candidate: false,
      decodeValid: false,
      detail: "scriptpubkey-hex-invalid",
      payloadHex: "",
      prefix: "",
      reasonCode: CANONICAL_OP_RETURN_SCRIPT_MALFORMED,
      scriptPubKeyHex: "",
      text: "",
    };
  }
  const script = Buffer.from(scriptPubKeyHex, "hex");
  if (script[0] !== 0x6a) {
    return {
      candidate: false,
      decodeValid: false,
      detail: "not-op-return",
      payloadHex: "",
      prefix: "",
      reasonCode: "",
      scriptPubKeyHex,
      text: "",
    };
  }

  const chunks = [];
  let offset = 1;
  while (offset < script.length) {
    const opcode = script[offset];
    offset += 1;
    let length;
    if (opcode === 0x00) {
      length = 0;
    } else if (opcode >= 0x01 && opcode <= 0x4b) {
      length = opcode;
    } else if (opcode === 0x4c) {
      if (offset + 1 > script.length) {
        return malformedCandidate(
          scriptPubKeyHex,
          chunks,
          "pushdata1-length-truncated",
        );
      }
      length = script[offset];
      offset += 1;
    } else if (opcode === 0x4d) {
      if (offset + 2 > script.length) {
        return malformedCandidate(
          scriptPubKeyHex,
          chunks,
          "pushdata2-length-truncated",
        );
      }
      length = script.readUInt16LE(offset);
      offset += 2;
    } else if (opcode === 0x4e) {
      if (offset + 4 > script.length) {
        return malformedCandidate(
          scriptPubKeyHex,
          chunks,
          "pushdata4-length-truncated",
        );
      }
      length = script.readUInt32LE(offset);
      offset += 4;
    } else {
      return malformedCandidate(
        scriptPubKeyHex,
        chunks,
        `non-push-opcode-${opcode.toString(16).padStart(2, "0")}`,
      );
    }
    if (offset + length > script.length) {
      chunks.push(script.subarray(offset));
      return malformedCandidate(
        scriptPubKeyHex,
        chunks,
        "push-payload-truncated",
      );
    }
    chunks.push(script.subarray(offset, offset + length));
    offset += length;
  }

  const payload = Buffer.concat(chunks);
  const prefix = governedPrefix(payload);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return {
      candidate: Boolean(prefix),
      decodeValid: false,
      detail: "payload-utf8-invalid",
      payloadHex: payload.toString("hex"),
      prefix,
      reasonCode: CANONICAL_OP_RETURN_UTF8_INVALID,
      scriptPubKeyHex,
      text: prefix,
    };
  }
  if (text.includes("\u0000")) {
    return {
      candidate: Boolean(prefix),
      decodeValid: false,
      detail: "payload-text-storage-invalid-u0000",
      payloadHex: payload.toString("hex"),
      prefix,
      reasonCode: CANONICAL_OP_RETURN_TEXT_STORAGE_INVALID,
      scriptPubKeyHex,
      text: prefix,
    };
  }
  return {
    candidate: Boolean(prefix),
    decodeValid: true,
    detail: "",
    payloadHex: payload.toString("hex"),
    prefix,
    reasonCode: "",
    scriptPubKeyHex,
    text,
  };
}

export function canonicalProtocolCandidateFromOutput(output) {
  const decoded = decodeCanonicalOpReturnOutput(output);
  return decoded.candidate ? decoded : null;
}

function canonicalProtocolFromPrefix(prefix) {
  return CANONICAL_PROTOCOL_PREFIXES.includes(prefix)
    ? prefix.slice(0, -1)
    : "";
}

export function canonicalRawProtocolPartFromOutput(
  output,
  protocolVout,
) {
  if (
    !Number.isSafeInteger(protocolVout) ||
    protocolVout < 0
  ) {
    throw new TypeError(
      "work-amo-v5-raw-protocol-vout-invalid",
    );
  }
  const candidate = canonicalProtocolCandidateFromOutput(output);
  return candidate
    ? {
        decodeDetail: candidate.detail,
        decodeValid: candidate.decodeValid,
        payloadHex: candidate.payloadHex,
        prefix: candidate.prefix,
        protocolVout,
        reasonCode: candidate.reasonCode,
        scriptPubKeyHex: candidate.scriptPubKeyHex,
        text: candidate.text,
      }
    : null;
}

/**
 * Reconstruct the complete governed record set for one exact transaction.
 *
 * Every non-PWM governed output is one record. All PWM outputs are one
 * canonical aggregate ordered by protocol vout and positioned at the first
 * PWM output. The returned evidence is derived only from transaction vout
 * script bytes and can therefore be compared with an ingestion envelope
 * before that envelope is allowed to drive consensus state.
 */
export function canonicalRawProtocolRecordSetFromTransaction(
  transaction,
) {
  if (
    !transaction ||
    typeof transaction !== "object" ||
    Array.isArray(transaction) ||
    !Array.isArray(transaction.vout)
  ) {
    throw new TypeError(
      "work-amo-v5-raw-transaction-vout-invalid",
    );
  }
  const records = [];
  const pwmParts = [];
  let rawProtocolCandidateCount = 0;
  for (
    let protocolVout = 0;
    protocolVout < transaction.vout.length;
    protocolVout += 1
  ) {
    const part = canonicalRawProtocolPartFromOutput(
      transaction.vout[protocolVout],
      protocolVout,
    );
    if (!part) {
      continue;
    }
    rawProtocolCandidateCount += 1;
    const protocol = canonicalProtocolFromPrefix(part.prefix);
    if (!protocol) {
      throw new TypeError(
        "work-amo-v5-raw-protocol-prefix-unsupported",
      );
    }
    if (protocol === "pwm1") {
      pwmParts.push(part);
      continue;
    }
    const rawRecordParts = [part];
    records.push({
      message: part.text,
      payload: {
        model: "canonical-raw-protocol-record-v1",
        rawRecordParts,
      },
      protocol,
      protocolVout,
      rawDecodeReasonCode: part.reasonCode,
      rawDecodeValid: part.decodeValid,
      rawRecordParts,
      recordOrdinal: 0,
    });
  }
  if (pwmParts.length > 0) {
    const protocolVout = pwmParts[0].protocolVout;
    const invalidPart = pwmParts.find(
      (part) => part.decodeValid !== true,
    );
    const lastProtocolVout =
      pwmParts[pwmParts.length - 1].protocolVout;
    const envelopeNoncontiguous = records.some(
      (record) =>
        record.protocolVout > protocolVout &&
        record.protocolVout < lastProtocolVout,
    );
    const rawDecodeReasonCode =
      invalidPart?.reasonCode ??
      (envelopeNoncontiguous
        ? CANONICAL_PWM_ENVELOPE_NONCONTIGUOUS
        : "");
    records.push({
      message: pwmParts.map((part) => part.text).join("\n"),
      payload: {
        model: "canonical-pwm-aggregate-record-v1",
        rawRecordParts: pwmParts,
      },
      protocol: "pwm1",
      protocolVout,
      rawDecodeReasonCode,
      rawDecodeValid: !rawDecodeReasonCode,
      rawRecordParts: pwmParts,
      recordOrdinal: 0,
    });
  }
  records.sort(
    (left, right) =>
      left.protocolVout - right.protocolVout ||
      left.recordOrdinal - right.recordOrdinal,
  );
  return {
    rawProtocolCandidateCount,
    records,
  };
}
