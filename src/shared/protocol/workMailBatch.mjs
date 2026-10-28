import { address as bitcoinAddress, networks } from "bitcoinjs-lib";

// Additive WORK transfer format. Parsing proves wire syntax only; transaction
// authority, activation, funding and atomic replay remain separate checks.
export const WORK_MAIL_BATCH_ACTION = "mailbatch1";
export const WORK_MAIL_BATCH_PROTOCOL_PREFIX = "pwt1:mailbatch1:";
export const WORK_MAIL_BATCH_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
export const WORK_MAIL_BATCH_REGISTRY_ADDRESS = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
export const WORK_MAIL_BATCH_MIN_RECIPIENTS = 1;
export const WORK_MAIL_BATCH_MAX_RECIPIENTS = 256;
export const WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES = 65_536;
export const WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS = 546;
export const WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS = WORK_MAIL_BATCH_MUTATION_PAYMENT_PROOFS;
export const WORK_MAIL_BATCH_SUBATOMS_PER_WORK = 10_000_000_000_000_000n;
export const WORK_MAIL_BATCH_MAX_SUBATOMS = 21_000_000n * WORK_MAIL_BATCH_SUBATOMS_PER_WORK;
export const WORK_MAIL_BATCH_MOVEMENT_MODEL = "canonical-work-mail-batch-opening-sum-v1";

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const WIRE_PREFIX = `${WORK_MAIL_BATCH_PROTOCOL_PREFIX}${WORK_MAIL_BATCH_TOKEN_ID}:`;
const MAX_INTEGER_DIGITS = WORK_MAIL_BATCH_MAX_SUBATOMS.toString().length;

function networkParameters(network) {
  if (network === "livenet") return networks.bitcoin;
  if (network === "testnet" || network === "testnet4") return networks.testnet;
  if (network === "regtest") return networks.regtest;
  throw new TypeError("Unknown WORK Mail batch network.");
}

export function canonicalWorkMailBatchAddress(value, { network = "livenet", validateAddress } = {}) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError("A WORK Mail batch recipient must be an exact address.");
  }
  // Validate before changing case so mixed-case Bech32 cannot be repaired into
  // an address that was not actually supplied. Base58 case is never changed.
  bitcoinAddress.toOutputScript(value, networkParameters(network));
  const canonical = /^(?:bc1|tb1|bcrt1)/iu.test(value) ? value.toLowerCase() : value;
  if (validateAddress !== undefined &&
      (typeof validateAddress !== "function" || validateAddress(canonical) !== true)) {
    throw new TypeError("Invalid WORK Mail batch recipient address.");
  }
  return canonical;
}

function exactAmount(value) {
  if (typeof value !== "string" || value.length > MAX_INTEGER_DIGITS ||
      !/^[1-9][0-9]*$/u.test(value) || BigInt(value) > WORK_MAIL_BATCH_MAX_SUBATOMS) {
    throw new TypeError("WORK Mail batch quantities must be positive canonical Q16 integer strings within supply.");
  }
  return value;
}

function canonicalRecipients(value, options, wire = false) {
  if (!Array.isArray(value) || value.length < WORK_MAIL_BATCH_MIN_RECIPIENTS ||
      value.length > WORK_MAIL_BATCH_MAX_RECIPIENTS ||
      Array.from({ length: value.length }, (_, index) => index).some((index) => !Object.hasOwn(value, index))) {
    throw new RangeError("A WORK Mail batch requires between 1 and 256 recipients.");
  }
  const seen = new Set();
  let total = 0n;
  const recipients = value.map((entry) => {
    const tuple = Array.isArray(entry);
    if (tuple ? entry.length !== 2 : wire || !entry || typeof entry !== "object" ||
        Object.keys(entry).length !== 2 || !Object.hasOwn(entry, "recipientAddress") ||
        !Object.hasOwn(entry, "amountSubatoms")) {
      throw new TypeError("A WORK Mail batch entry contains exactly an address and a subatom amount.");
    }
    const suppliedAddress = tuple ? entry[0] : entry.recipientAddress;
    const recipientAddress = canonicalWorkMailBatchAddress(suppliedAddress, options);
    if (wire && recipientAddress !== suppliedAddress) {
      throw new TypeError("WORK Mail batch wire addresses must already be canonical.");
    }
    if (seen.has(recipientAddress)) throw new TypeError("Duplicate WORK Mail batch recipient.");
    seen.add(recipientAddress);
    const amountSubatoms = exactAmount(tuple ? entry[1] : entry.amountSubatoms);
    total += BigInt(amountSubatoms);
    if (total > WORK_MAIL_BATCH_MAX_SUBATOMS) throw new RangeError("WORK Mail batch total exceeds the WORK supply.");
    return Object.freeze({ recipientAddress, amountSubatoms });
  });
  return Object.freeze({
    kind: "mail-batch",
    tokenId: WORK_MAIL_BATCH_TOKEN_ID,
    amountVersion: WORK_MAIL_BATCH_ACTION,
    recipients: Object.freeze(recipients),
    totalAmountSubatoms: total.toString(),
    recipientCount: recipients.length,
  });
}

function encodeBase64url(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index], b = bytes[index + 1], c = bytes[index + 2];
    result += BASE64URL[a >> 2];
    result += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) result += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) result += BASE64URL[c & 63];
  }
  return result;
}

function decodeBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return null;
  const bytes = [];
  let accumulator = 0, bits = 0;
  for (const character of value) {
    accumulator = (accumulator << 6) | BASE64URL.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 255);
    }
  }
  const decoded = new Uint8Array(bytes);
  return encodeBase64url(decoded) === value ? decoded : null;
}

function recordText(batch) {
  return JSON.stringify(batch.recipients.map(({ recipientAddress, amountSubatoms }) =>
    [recipientAddress, amountSubatoms]));
}

export function validateWorkMailBatchRecipients(recipients, options = {}) {
  return canonicalRecipients(recipients, options);
}

export function buildWorkMailBatchPayload(recipients, options = {}) {
  const batch = validateWorkMailBatchRecipients(recipients, options);
  const payload = WIRE_PREFIX + encodeBase64url(new TextEncoder().encode(recordText(batch)));
  if (new TextEncoder().encode(payload).length > WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES) {
    throw new RangeError("WORK Mail batch protocol payload exceeds 65,536 UTF-8 bytes.");
  }
  return payload;
}

export function parseWorkMailBatchPayload(payload, options = {}) {
  if (typeof payload !== "string" || !payload.startsWith(WIRE_PREFIX) ||
      payload.length > WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES) return null;
  const bytes = decodeBase64url(payload.slice(WIRE_PREFIX.length));
  if (!bytes) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const batch = canonicalRecipients(JSON.parse(text), options, true);
    // Exact reserialization rejects alternate JSON escapes, whitespace, numeric
    // amounts, extra tuple members and every noncanonical base64url spelling.
    return recordText(batch) === text ? batch : null;
  } catch {
    return null;
  }
}

export function workMailBatchNonSelfAmountSubatoms(batch, senderAddress, options = {}) {
  const sender = canonicalWorkMailBatchAddress(senderAddress, options);
  const parsed = validateWorkMailBatchRecipients(batch?.recipients, options);
  return parsed.recipients.reduce((sum, recipient) => sum +
    (recipient.recipientAddress === sender ? 0n : BigInt(recipient.amountSubatoms)), 0n).toString();
}

export function workMailBatchMovementValueQ8(batch, senderAddress, openingNetworkValueQ8, options = {}) {
  if (typeof openingNetworkValueQ8 !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(openingNetworkValueQ8)) {
    throw new TypeError("WORK Mail batch opening network value must be an exact nonnegative Q8 integer string.");
  }
  return (BigInt(workMailBatchNonSelfAmountSubatoms(batch, senderAddress, options)) *
    BigInt(openingNetworkValueQ8) / WORK_MAIL_BATCH_MAX_SUBATOMS).toString();
}

// Composer precheck for semantic companions; transaction validation additionally
// proves the complete signed PWM envelope and all of its ordinary recipients.
export function workMailBatchMemoIsOrdinary({ message, parentTxid, hasAttachment = false } = {}) {
  if (typeof message !== "string" || message.trimStart().startsWith("pwj1:")) return false;
  return Boolean(parentTxid) || hasAttachment === true || !["powb", "incb"].includes(message.trim().toLowerCase());
}

// The sealed reader proves these values against the complete ordinary PWM
// witness. Summary consumers retain that evidence binding, not a second Mail
// payment or an invented reconstruction of the omitted PWM carrier bytes.
export function workMailBatchEnvelopeMatches(envelope, recipients, protocolVout) {
  const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...keys].sort().join("|");
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 256 ||
      !exactKeys(envelope, ["protocolVout", "lastProtocolVout", "recordOrdinal", "kind", "payloadCommitment", "recipients"]) ||
      envelope.protocolVout !== recipients.length || envelope.recordOrdinal !== 0 ||
      !Number.isSafeInteger(envelope.lastProtocolVout) || envelope.lastProtocolVout < envelope.protocolVout ||
      protocolVout !== envelope.lastProtocolVout + 2 ||
      !["mail", "reply", "file"].includes(envelope.kind) ||
      !exactKeys(envelope.payloadCommitment, ["model", "sha256", "payloadBytes"]) ||
      envelope.payloadCommitment.model !== "canonical-work-amo-payload-sha256-v1" ||
      !/^[0-9a-f]{64}$/u.test(envelope.payloadCommitment.sha256 ?? "") ||
      !Number.isSafeInteger(envelope.payloadCommitment.payloadBytes) || envelope.payloadCommitment.payloadBytes <= 0 ||
      !Array.isArray(envelope.recipients) || envelope.recipients.length !== recipients.length) return false;
  return envelope.recipients.every((payment, index) =>
    exactKeys(payment, ["recipientAddress", "amountSats", "vout"]) && payment.vout === index &&
    payment.recipientAddress === recipients[index].recipientAddress && typeof payment.amountSats === "string" &&
    /^[1-9][0-9]{0,15}$/u.test(payment.amountSats) && BigInt(payment.amountSats) <= 2_100_000_000_000_000n);
}
