import { Buffer } from "buffer";
import { crypto, opcodes, script, Transaction } from "bitcoinjs-lib";

import { POWCAT_MAX_FILE_BYTES } from "./powcatLimits.mjs";
export { POWCAT_MAX_FILE_BYTES } from "./powcatLimits.mjs";
export const POWCAT_MAX_PART_BYTES = 96_000;
export const POWCAT_MAX_PARTS = 67;
const MAX_WEIGHT = 400_000;
const PART = Buffer.from("powcat1:p");
const MANIFEST = Buffer.from("powcat1:m");
const HASH = /^[0-9a-f]{64}$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function requireField(valid, detail) {
  if (!valid) throw new Error(`powcat1: ${detail}`);
}

function integerIn(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isHash(value) {
  return typeof value === "string" && HASH.test(value);
}

export function powcatSha256(bytes) {
  return Buffer.from(crypto.sha256(bytes)).toString("hex");
}

function checkPart(index, count, bytes) {
  requireField(integerIn(count, 1, POWCAT_MAX_PARTS) && integerIn(index, 0, count - 1), "invalid part index or count");
  requireField(bytes instanceof Uint8Array && integerIn(bytes.length, 1, POWCAT_MAX_PART_BYTES), "invalid part size");
}

export function encodePowcatPart({ fileHash, index, count, bytes }) {
  requireField(isHash(fileHash), "invalid file hash");
  checkPart(index, count, bytes);
  return Buffer.concat([PART, Buffer.from(fileHash, "hex"), Buffer.from([index, count]), crypto.sha256(bytes), bytes]);
}

function checkManifest({ fileHash, size, name, mime, partTxids }) {
  requireField(isHash(fileHash), "invalid file hash");
  requireField(Array.isArray(partTxids) && integerIn(partTxids.length, 1, POWCAT_MAX_PARTS), "invalid manifest part count");
  requireField(integerIn(size, partTxids.length, Math.min(POWCAT_MAX_FILE_BYTES, partTxids.length * POWCAT_MAX_PART_BYTES)), "impossible manifest size");
  requireField(partTxids.every(isHash) && new Set(partTxids).size === partTxids.length, "invalid or duplicate part TXID");
  requireField(typeof name === "string" && integerIn(name.length, 1, 255) &&
    !/[\\/\u0000-\u001f\u007f-\u009f]/u.test(name) && name !== "." && name !== "..", "invalid file name");
  const nameBytes = Buffer.from(name, "utf8");
  requireField(nameBytes.length <= 255 && utf8.decode(nameBytes) === name, "invalid file name encoding or length");
  requireField(typeof mime === "string" && mime.length <= 127 &&
    /^[a-z0-9][a-z0-9!#$&^_.+\-]*\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u.test(mime), "invalid MIME type");
  return nameBytes;
}

export function encodePowcatManifest(manifest) {
  const nameBytes = checkManifest(manifest);
  const { fileHash, size, mime, partTxids } = manifest;
  const fields = Buffer.alloc(7);
  fields.writeUInt32BE(size, 0);
  fields[4] = partTxids.length;
  fields[5] = nameBytes.length;
  fields[6] = mime.length;
  return Buffer.concat([MANIFEST, Buffer.from(fileHash, "hex"), fields, nameBytes, Buffer.from(mime),
    ...partTxids.map(txid => Buffer.from(txid, "hex"))]);
}

export function powcatScript(payload) {
  return script.compile([opcodes.OP_RETURN, payload]);
}

function decodePayload(payload) {
  const prefix = payload.subarray(0, PART.length);
  const offset = PART.length + 32;
  const fileHash = payload.subarray(PART.length, offset).toString("hex");
  if (prefix.equals(PART)) {
    requireField(payload.length > offset + 34, "truncated part");
    const index = payload[offset];
    const count = payload[offset + 1];
    const partHash = payload.subarray(offset + 2, offset + 34).toString("hex");
    const bytes = payload.subarray(offset + 34);
    checkPart(index, count, bytes);
    requireField(powcatSha256(bytes) === partHash, "part hash mismatch");
    return { kind: "part", fileHash, index, count, partHash, bytes };
  }
  requireField(prefix.equals(MANIFEST) && payload.length >= offset + 7, "invalid manifest header");
  const size = payload.readUInt32BE(offset);
  const count = payload[offset + 4];
  const nameStart = offset + 7;
  const mimeStart = nameStart + payload[offset + 5];
  const refsStart = mimeStart + payload[offset + 6];
  requireField(count >= 1 && count <= POWCAT_MAX_PARTS && refsStart + count * 32 === payload.length, "invalid manifest framing");
  const name = utf8.decode(payload.subarray(nameStart, mimeStart));
  const mime = utf8.decode(payload.subarray(mimeStart, refsStart));
  const partTxids = [];
  for (let start = refsStart; start < payload.length; start += 32) {
    partTxids.push(payload.subarray(start, start + 32).toString("hex"));
  }
  const manifest = { kind: "manifest", fileHash, size, name, mime, partTxids };
  checkManifest(manifest);
  return manifest;
}

export function parsePowcatOutputScript(scriptBytes) {
  requireField(scriptBytes instanceof Uint8Array && scriptBytes.length <= 100_000, "invalid data carrier");
  const chunks = script.decompile(scriptBytes);
  requireField(chunks?.length === 2 && chunks[0] === opcodes.OP_RETURN && chunks[1] instanceof Uint8Array &&
    Buffer.from(powcatScript(chunks[1])).equals(Buffer.from(scriptBytes)), "expected one canonical data push");
  return decodePayload(Buffer.from(chunks[1]));
}

export function parsePowcatTransaction(rawHex, expectedTxid) {
  requireField(isHash(expectedTxid), "invalid expected TXID");
  requireField(typeof rawHex === "string" && rawHex.length <= MAX_WEIGHT * 2 &&
    rawHex.length % 2 === 0 && /^[0-9a-f]+$/iu.test(rawHex), "invalid raw transaction hex");
  const tx = Transaction.fromHex(rawHex);
  requireField(tx.byteLength() === rawHex.length / 2, "noncanonical transaction encoding");
  requireField(tx.weight() <= MAX_WEIGHT && tx.ins.length > 0 && !tx.isCoinbase(), "invalid carrier transaction");
  requireField(tx.getId() === expectedTxid, "raw transaction TXID mismatch");
  const carriers = tx.outs.filter(output => output.script[0] === opcodes.OP_RETURN);
  requireField(carriers.length === 1 && carriers[0].value === 0n && carriers[0].script.length <= 100_000, "expected one zero-value data carrier");
  return parsePowcatOutputScript(carriers[0].script);
}

// loadConfirmed supplies exact raw bytes and active-chain inclusion evidence
// on one selected network. The adapter fences that evidence against reorgs.
export async function resolvePowcatFile(rootTxid, loadConfirmed) {
  async function readConfirmed(txid) {
    requireField(isHash(txid), "invalid TXID");
    const evidence = await loadConfirmed(txid);
    requireField(evidence && (evidence.confirmed === undefined || evidence.confirmed === true) && Number.isSafeInteger(evidence.blockHeight) &&
      evidence.blockHeight > 0 && isHash(evidence.blockHash), "missing confirmed inclusion evidence");
    return { record: parsePowcatTransaction(evidence.hex, txid), height: evidence.blockHeight };
  }
  const root = await readConfirmed(rootTxid);
  const manifest = root.record;
  requireField(manifest.kind === "manifest", "root is not a manifest");
  const bytes = new Uint8Array(manifest.size);
  let offset = 0;
  for (const [index, txid] of manifest.partTxids.entries()) {
    const { record: part, height } = await readConfirmed(txid);
    requireField(height < root.height, "part must confirm in an earlier block");
    requireField(part.kind === "part" && part.fileHash === manifest.fileHash &&
      part.index === index && part.count === manifest.partTxids.length, "part does not match manifest");
    requireField(offset + part.bytes.length <= bytes.length, "parts exceed declared file size");
    bytes.set(part.bytes, offset);
    offset += part.bytes.length;
  }
  requireField(offset === bytes.length && powcatSha256(bytes) === manifest.fileHash, "file size or hash mismatch");
  return { txid: rootTxid, fileHash: manifest.fileHash, name: manifest.name, mime: manifest.mime,
    size: manifest.size, partTxids: manifest.partTxids, bytes };
}
