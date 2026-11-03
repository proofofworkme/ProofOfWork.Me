import { Buffer } from "buffer";
import { powcatSha256 } from "./powcat1.mjs";

export const POWCAT_MAIL_MIME = "application/vnd.proofofwork.powcat1";
const pointerPattern = /^pwm1:cat1:([0-9a-f]{64}):([0-9a-f]{64})$/u;

export function parsePowcatPointer(text) {
  const match = typeof text === "string" && text.length === 139 && text.match(pointerPattern);
  return match ? { txid: match[1], fileHash: match[2] } : null;
}

export function buildPowcatPointer(txid, fileHash) {
  const text = `pwm1:cat1:${txid}:${fileHash}`;
  if (!parsePowcatPointer(text)) throw new Error("Invalid linked file reference.");
  return text;
}

function base64url(bytes) {
  return bytes.toString("base64").replace(/=/gu, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

export function buildPowcatMailAttachment({ txid, fileHash, name }) {
  const bytes = Buffer.from(buildPowcatPointer(txid, fileHash), "utf8");
  // Older clients can download this reference without confusing it with the original file.
  let label = "";
  for (const char of name.trim().replace(/\s+/gu, " ")) {
    if (label.length + char.length > 113) break;
    label += char;
  }
  return { name: `${label || "file"}.powcat`, mime: POWCAT_MAIL_MIME, size: bytes.length,
    sha256: powcatSha256(bytes), data: base64url(bytes) };
}

export function powcatPointerFromAttachment(attachment) {
  if (attachment?.mime !== POWCAT_MAIL_MIME || attachment.size !== 139 ||
      typeof attachment.data !== "string" || attachment.data.length !== 186) return null;
  const bytes = Buffer.from(attachment.data.replace(/-/gu, "+").replace(/_/gu, "/"), "base64");
  if (base64url(bytes) !== attachment.data || powcatSha256(bytes) !== attachment.sha256) return null;
  return parsePowcatPointer(bytes.toString("utf8"));
}
