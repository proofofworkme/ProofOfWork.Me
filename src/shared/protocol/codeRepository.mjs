/** Code v1 is an inert source tree over exact transaction evidence. */
export const CODE_PROTOCOL_PREFIX = "pwc1:";
export const CODE_VERSION = 1;
export const CODE_MAX_SOURCE_BYTES = 60_000;
export const CODE_MAX_DATA_CARRIER_BYTES = 100_000;
export const CODE_MAX_NAME_BYTES = 200;
export const CODE_MAX_DESCRIPTION_BYTES = 1_000;
export const CODE_MAX_MESSAGE_BYTES = 500;
export const CODE_MAX_PATH_BYTES = 1_024;
export const CODE_MAX_METADATA_BYTES = 4_096;
export const CODE_SOURCE_NAME = "source.txt";
export const CODE_SOURCE_MIME = "text/plain";
export const CODE_EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const txidPattern = /^[0-9a-f]{64}$/u;
const controls = /[\u0000-\u001f\u007f-\u009f]/u;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

/** Reject replacement encoding and PostgreSQL-unrepresentable NUL; never trim source. */
export function codeSourceBytes(text) {
  if (typeof text !== "string" || text.includes("\u0000")) return null;
  const bytes = encoder.encode(text);
  try { return decoder.decode(bytes) === text ? bytes : null; } catch { return null; }
}

function boundedText(value, max, { nonempty = false, clean = false } = {}) {
  const bytes = codeSourceBytes(value);
  return Boolean(bytes && bytes.length <= max && (!nonempty || value.trim()) &&
    (!clean || (!controls.test(value) && value.trim() === value)));
}

/** Exact relative POSIX paths; no Unicode or case normalization. */
export function validateCodePath(path) {
  if (!boundedText(path, CODE_MAX_PATH_BYTES, { nonempty: true }) || controls.test(path) ||
      path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/u.test(path)) return false;
  const parts = path.split("/");
  return parts.length <= 64 && parts.every(part => part !== "" && part !== "." && part !== ".." &&
    encoder.encode(part).length <= 255);
}

function normalizeRepository(value) {
  if (!exactKeys(value, ["v", "name", "description"]) || value.v !== CODE_VERSION ||
      !boundedText(value.name, CODE_MAX_NAME_BYTES, { nonempty: true, clean: true }) ||
      !boundedText(value.description, CODE_MAX_DESCRIPTION_BYTES)) return null;
  return { v: 1, name: value.name, description: value.description };
}

function normalizeCommit(value) {
  if (!record(value) || !["put", "delete"].includes(value.op)) return null;
  const keys = ["v", "repo", "parent", "op", "path", "message", ...(value.op === "put" ? ["sha256", "size"] : [])];
  if (!exactKeys(value, keys) || value.v !== CODE_VERSION || !txidPattern.test(value.repo) ||
      !txidPattern.test(value.parent) || !validateCodePath(value.path) ||
      !boundedText(value.message, CODE_MAX_MESSAGE_BYTES)) return null;
  if (value.op === "put" && (!txidPattern.test(value.sha256) || !Number.isSafeInteger(value.size) ||
      value.size < 0 || value.size > CODE_MAX_SOURCE_BYTES ||
      (value.size === 0 && value.sha256 !== CODE_EMPTY_SHA256))) return null;
  return { v: 1, repo: value.repo, parent: value.parent, op: value.op, path: value.path,
    message: value.message, ...(value.op === "put" ? { sha256: value.sha256, size: value.size } : {}) };
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function decodeBase64Url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/u.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/gu, "+").replace(/_/gu, "/"));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return encodeBase64Url(bytes) === text ? bytes : null;
  } catch { return null; }
}

function encodeMetadata(kind, value, normalize) {
  const metadata = normalize(value);
  if (!metadata) throw new Error(`Invalid Code ${kind} metadata.`);
  const json = JSON.stringify(metadata);
  const bytes = encoder.encode(json);
  if (bytes.length > CODE_MAX_METADATA_BYTES) throw new Error("Code metadata exceeds its byte budget.");
  return `${CODE_PROTOCOL_PREFIX}${kind}:${encodeBase64Url(bytes)}`;
}

export function encodeCodeRepository(value) { return encodeMetadata("repo", value, normalizeRepository); }
export function encodeCodeCommit(value) { return encodeMetadata("commit", value, normalizeCommit); }

/** Only the exact encoder form is canonical: closed keys, key order, decimals and UTF-8. */
export function parseCodePayload(payload) {
  if (typeof payload !== "string") return null;
  const match = /^pwc1:(repo|commit):([A-Za-z0-9_-]+)$/u.exec(payload);
  if (!match || match[2].length > Math.ceil(CODE_MAX_METADATA_BYTES * 4 / 3)) return null;
  const bytes = decodeBase64Url(match[2]);
  if (!bytes || bytes.length > CODE_MAX_METADATA_BYTES) return null;
  try {
    const json = decoder.decode(bytes);
    const metadata = (match[1] === "repo" ? normalizeRepository : normalizeCommit)(JSON.parse(json));
    return metadata && JSON.stringify(metadata) === json ? { kind: match[1], metadata } : null;
  } catch { return null; }
}

function hexBytes(hex) {
  if (typeof hex !== "string" || !/^(?:[0-9a-fA-F]{2})+$/u.test(hex)) return null;
  return Uint8Array.from(hex.match(/../gu), byte => Number.parseInt(byte, 16));
}
function joinBytes(chunks) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function bytePrefix(bytes, prefix) {
  return bytes.length >= prefix.length && [...prefix].every((character, index) => bytes[index] === character.charCodeAt(0));
}
function scriptHex(output) { return output?.scriptpubkey ?? output?.scriptPubKey?.hex ?? output?.scriptPubKeyHex ?? output?.scriptHex; }

/** Decode every physical OP_RETURN directly from its script, including malformed prefix evidence. */
function decodeOutput(output, voutIndex) {
  const script = hexBytes(scriptHex(output));
  if (!script) return { voutIndex, scriptValid: false, nulldata: false, valid: false, bytes: new Uint8Array() };
  if (script[0] !== 0x6a) return { voutIndex, scriptValid: true, nulldata: false, valid: true, bytes: new Uint8Array() };
  const chunks = [];
  let offset = 1, valid = true;
  while (offset < script.length) {
    const opcode = script[offset++];
    let length = 0, width = 0;
    if (opcode <= 0x4b) length = opcode;
    else if (opcode >= 0x4c && opcode <= 0x4e) width = 2 ** (opcode - 0x4c);
    else { valid = false; break; }
    if (width) {
      if (offset + width > script.length) { valid = false; break; }
      for (let index = 0; index < width; index++) length += script[offset + index] * 2 ** (8 * index);
      offset += width;
    }
    if (offset + length > script.length) { chunks.push(script.subarray(offset)); valid = false; break; }
    chunks.push(script.subarray(offset, offset + length)); offset += length;
  }
  const bytes = joinBytes(chunks);
  let text = "";
  if (valid) { try { text = decoder.decode(bytes); valid = !text.includes("\u0000"); } catch { valid = false; } }
  return { voutIndex, scriptValid: true, nulldata: true, valid, bytes, text, scriptBytes: script.length,
    codeCandidate: bytePrefix(bytes, CODE_PROTOCOL_PREFIX), pwmCandidate: bytePrefix(bytes, "pwm1:") };
}

function exactValue(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = typeof value === "bigint" ? value.toString() : String(value ?? "");
  return /^(?:0|[1-9]\d*)$/u.test(text) ? BigInt(text) : null;
}
function outputAddress(output) { return output?.scriptpubkey_address ?? output?.scriptPubKey?.address ?? output?.address ?? ""; }
function inputAddress(input) {
  const prevout = input?.prevout ?? input?.previousOutput;
  return prevout?.scriptpubkey_address ?? prevout?.scriptPubKey?.address ?? prevout?.address ?? "";
}
function canonicalStatus(tx) {
  if (typeof tx.status === "string") return ["confirmed", "pending", "dropped", "orphaned"].includes(tx.status) ? tx.status : "unknown";
  return tx.status?.confirmed === true ? "confirmed" : "pending";
}
function position(tx) {
  return { blockHeight: tx.blockHeight ?? tx.status?.block_height ?? null,
    blockHash: tx.blockHash ?? tx.status?.block_hash ?? "",
    blockTransactionIndex: tx.blockTransactionIndex ?? tx.blockIndex ?? tx.status?.block_index ?? null };
}

function attachmentFromRecords(records, sha256) {
  const parts = records.filter(item => item.text.startsWith("pwm1:a:"));
  if (!parts.length) return { attachment: null, error: "" };
  const chunks = new Map();
  let metadata, total;
  for (const item of parts) {
    const match = /^pwm1:a:([^:]+):([^:]+):([1-9]\d*):([0-9a-f]{64}):(0|[1-9]\d*)\/([1-9]\d*):([A-Za-z0-9_-]*)$/u.exec(item.text);
    if (!match) return { attachment: null, error: "code-attachment-malformed" };
    const mimeBytes = decodeBase64Url(match[1]), nameBytes = decodeBase64Url(match[2]);
    let mime = "", name = "";
    try { mime = decoder.decode(mimeBytes ?? new Uint8Array()); name = decoder.decode(nameBytes ?? new Uint8Array()); } catch { /* rejected below */ }
    const size = Number(match[3]), index = Number(match[5]), count = Number(match[6]);
    const next = { mime, name, size, sha256: match[4] };
    if (mime !== CODE_SOURCE_MIME || name !== CODE_SOURCE_NAME || size > CODE_MAX_SOURCE_BYTES ||
        !Number.isSafeInteger(size) || !Number.isSafeInteger(index) || !Number.isSafeInteger(count) ||
        count > 1_000 || index >= count || chunks.has(index) ||
        (metadata && (JSON.stringify(metadata) !== JSON.stringify(next) || total !== count))) {
      return { attachment: null, error: "code-attachment-ambiguous" };
    }
    metadata = next; total = count; chunks.set(index, match[7]);
  }
  if (chunks.size !== total) return { attachment: null, error: "code-attachment-incomplete" };
  const data = Array.from({ length: total }, (_, index) => chunks.get(index)).join("");
  const bytes = decodeBase64Url(data);
  if (!bytes || bytes.length !== metadata.size || typeof sha256 !== "function" || sha256(bytes) !== metadata.sha256) {
    return { attachment: null, error: "code-attachment-bytes-unverified" };
  }
  try {
    const content = decoder.decode(bytes);
    if (content.includes("\u0000")) return { attachment: null, error: "code-source-text-invalid" };
    return { attachment: { ...metadata, data, content }, error: "" };
  } catch { return { attachment: null, error: "code-source-text-invalid" }; }
}

/**
 * Inputs must be hydrated from first-party prevouts; output addresses must be
 * script-derived. UI metadata, parsed-carrier flags and supplied attachments
 * are never used as content or ownership evidence.
 */
export function verifyCodeTransaction(tx, { sha256 } = {}) {
  if (!record(tx) || !Array.isArray(tx.vout)) return null;
  const decoded = tx.vout.map(decodeOutput);
  const candidates = decoded.filter(item => item.codeCandidate);
  if (!candidates.length) return null;
  const first = candidates[0];
  const parsed = first.valid ? parseCodePayload(first.text) : null;
  const errors = [];
  const reject = reason => { if (!errors.includes(reason)) errors.push(reason); };
  if (!txidPattern.test(tx.txid)) reject("code-txid-invalid");
  if (candidates.length !== 1) reject("code-carrier-ambiguous");
  if (!parsed) reject("code-metadata-invalid");
  if (decoded.some(item => !item.scriptValid || (item.nulldata && !item.valid))) reject("code-raw-script-invalid");
  const carriers = decoded.filter(item => item.nulldata);
  const carrierBytes = carriers.reduce((sum, item) => sum + (item.scriptBytes ?? 0), 0);
  if (carrierBytes > CODE_MAX_DATA_CARRIER_BYTES) reject("code-carrier-budget-exceeded");
  if (carriers.some(item => !item.codeCandidate && !item.pwmCandidate)) reject("code-mixed-carrier-invalid");
  if (carriers.some(item => exactValue(tx.vout[item.voutIndex].value ?? tx.vout[item.voutIndex].proofs) !== 0n)) reject("code-funded-carrier-invalid");
  const inputs = Array.isArray(tx.vin) ? tx.vin : Array.isArray(tx.inputs) ? tx.inputs : [];
  const addresses = inputs.map(inputAddress);
  const ownerAddress = addresses[0] ?? "";
  if (typeof ownerAddress !== "string" || !ownerAddress || addresses.some(address => address !== ownerAddress) || inputs.length === 0 || inputs.some(input => input.coinbase)) reject("code-input-authority-unavailable");
  const pwm = carriers.filter(item => item.pwmCandidate);
  if (!pwm.length || pwm.some(item => !item.valid || !/^pwm1:(?:m|s|a):/u.test(item.text))) reject("code-mail-envelope-invalid");
  if (pwm.length && carriers.some(item => !item.pwmCandidate && item.voutIndex > pwm[0].voutIndex && item.voutIndex < pwm.at(-1).voutIndex)) reject("code-mail-envelope-noncontiguous");
  if (pwm.length && pwm.at(-1).voutIndex >= first.voutIndex) reject("code-mail-carrier-order-invalid");
  const subjects = pwm.filter(item => item.text.startsWith("pwm1:s:"));
  if (subjects.length > 1 || subjects.some(item => {
    const bytes = decodeBase64Url(item.text.slice(7));
    try { return !bytes || !codeSourceBytes(decoder.decode(bytes)); } catch { return true; }
  })) reject("code-mail-subject-invalid");
  const messageRecords = pwm.filter(item => item.text.startsWith("pwm1:m:"));
  const attachments = attachmentFromRecords(pwm, sha256);
  if (attachments.error) reject(attachments.error);
  if (!messageRecords.length && !subjects.some(item => item.text.length > 7) && !attachments.attachment) reject("code-mail-envelope-empty");
  const boundary = Math.min(first.voutIndex, pwm[0]?.voutIndex ?? first.voutIndex);
  let payment = 0n;
  tx.vout.forEach((output, index) => {
    const value = exactValue(output.value ?? output.proofs);
    if (value === null) reject("code-output-value-invalid");
    else if (index < boundary && outputAddress(output) === ownerAddress) payment += value;
  });
  if (payment < 546n) reject("code-self-payment-insufficient");
  const metadata = parsed?.metadata ?? null;
  let source;
  if (parsed?.kind === "commit" && metadata.op === "put") {
    if (metadata.size === 0) {
      if (attachments.attachment || pwm.some(item => item.text.startsWith("pwm1:a:"))) reject("code-empty-source-attachment-invalid");
      source = { txid: tx.txid, name: CODE_SOURCE_NAME, mime: CODE_SOURCE_MIME, size: 0, sha256: CODE_EMPTY_SHA256, data: "", content: "" };
    } else if (!attachments.attachment || attachments.attachment.sha256 !== metadata.sha256 || attachments.attachment.size !== metadata.size) reject("code-source-commitment-mismatch");
    else source = { txid: tx.txid, ...attachments.attachment };
  } else if (pwm.some(item => item.text.startsWith("pwm1:a:"))) reject("code-unexpected-attachment");
  const status = canonicalStatus(tx);
  const canonicalPosition = position(tx);
  if (status === "confirmed" && (!Number.isSafeInteger(canonicalPosition.blockHeight) || canonicalPosition.blockHeight < 0 ||
      !txidPattern.test(canonicalPosition.blockHash) || !Number.isSafeInteger(canonicalPosition.blockTransactionIndex) || canonicalPosition.blockTransactionIndex < 0)) reject("code-canonical-position-unavailable");
  return { txid: tx.txid, protocol: "pwc1", kind: parsed?.kind === "repo" ? "code-repository" : "code-commit",
    ownerAddress, repoTxid: parsed?.kind === "repo" ? tx.txid : metadata?.repo ?? "",
    parentTxid: parsed?.kind === "commit" ? metadata.parent : "", path: metadata?.path ?? "", message: metadata?.message ?? "",
    metadata, status, confirmed: status === "confirmed", ...canonicalPosition, blockIndex: canonicalPosition.blockTransactionIndex,
    protocolVout: first.voutIndex, recordOrdinal: 0, amountSats: payment.toString(), carrierBytes,
    rawPayload: first.text ?? "", rawPayloadHex: [...first.bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""),
    valid: errors.length === 0, validationErrors: errors, applied: false, ...(source ? { source } : {}) };
}

function compareUtf8(left, right) {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}
function compareEvents(left, right) {
  const confirmed = Number(right.status === "confirmed") - Number(left.status === "confirmed");
  if (confirmed) return confirmed;
  if (left.status !== "confirmed") return compareUtf8(left.txid, right.txid);
  for (const key of ["blockHeight", "blockTransactionIndex", "protocolVout", "recordOrdinal"]) {
    const difference = (left[key] ?? Number.MAX_SAFE_INTEGER) - (right[key] ?? Number.MAX_SAFE_INTEGER);
    if (difference) return difference;
  }
  return compareUtf8(left.txid, right.txid);
}

/** Callers establish complete hash-bound discovery before presenting this tree as canonical. */
export function replayCodeTransactions(transactions, options = {}) {
  if (!Array.isArray(transactions)) throw new Error("Code replay requires complete transaction evidence.");
  const events = transactions.map(tx => verifyCodeTransaction(tx, options)).filter(Boolean).sort(compareEvents);
  const seen = new Set(), positions = new Set(), blockHashes = new Map(), repositories = new Map();
  for (const event of events) {
    if (seen.has(event.txid)) throw new Error("Code replay contains duplicate transaction evidence.");
    seen.add(event.txid);
    if (event.status === "confirmed" && event.validationErrors.indexOf("code-canonical-position-unavailable") < 0) {
      const slot = `${event.blockHeight}:${event.blockTransactionIndex}`;
      if (positions.has(slot)) throw new Error("Code replay contains ambiguous canonical transaction positions.");
      positions.add(slot);
      if (blockHashes.has(event.blockHeight) && blockHashes.get(event.blockHeight) !== event.blockHash) throw new Error("Code replay mixes canonical block hashes.");
      blockHashes.set(event.blockHeight, event.blockHash);
    }
    if (!event.valid || event.status !== "confirmed") continue;
    const reject = reason => { event.valid = false; event.validationErrors.push(reason); };
    if (event.kind === "code-repository") {
      repositories.set(event.txid, { txid: event.txid, repoTxid: event.txid, name: event.metadata.name,
        description: event.metadata.description, ownerAddress: event.ownerAddress, headTxid: event.txid,
        blockHeight: event.blockHeight, blockHash: event.blockHash, blockTransactionIndex: event.blockTransactionIndex,
        files: [], commits: [event] });
      event.applied = true; continue;
    }
    const repo = repositories.get(event.repoTxid);
    if (!repo) { reject("code-repository-unavailable"); continue; }
    repo.commits.push(event);
    if (repo.ownerAddress !== event.ownerAddress) { reject("code-owner-mismatch"); continue; }
    if (repo.headTxid !== event.parentTxid) { reject("code-parent-stale"); continue; }
    const path = event.path;
    if (event.metadata.op === "delete") {
      if (!repo.files.some(file => file.path === path)) { reject("code-delete-path-missing"); continue; }
      repo.files = repo.files.filter(file => file.path !== path);
    } else {
      if (repo.files.some(file => file.path !== path && (file.path.startsWith(`${path}/`) || path.startsWith(`${file.path}/`)))) {
        reject("code-path-prefix-collision"); continue;
      }
      repo.files = [...repo.files.filter(file => file.path !== path), { path, ...event.source }]
        .sort((left, right) => compareUtf8(left.path, right.path));
    }
    repo.headTxid = event.txid; event.applied = true;
  }
  return { repositories: [...repositories.values()], events };
}
