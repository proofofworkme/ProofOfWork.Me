import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";
import { formatBytes } from "../../functions";
import { MAX_DATA_CARRIER_BYTES } from "../bitcoin/protocolLimits";
import {
  base64UrlEncodeBytes,
  byteLength,
  chunkAscii,
  encodeTextBase64Url,
  sha256Hex,
} from "../utils/encoding";

export const MAX_ATTACHMENT_BYTES = 60_000;

export type MailAttachment = {
  name: string;
  mime: string;
  size: number;
  sha256: string;
  data: string;
};

export function normalizeAttachmentName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 120) || "attachment";
}

export function normalizeAttachmentMime(mime: string) {
  return mime.trim().slice(0, 120) || "application/octet-stream";
}

export async function attachmentFromFile(file: File): Promise<MailAttachment> {
  if (file.size <= 0) {
    throw new Error("Attachment is empty.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment must be ${formatBytes(MAX_ATTACHMENT_BYTES)} or smaller.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) {
    throw new Error("Attachment changed while loading.");
  }
  return {
    data: base64UrlEncodeBytes(bytes),
    mime: normalizeAttachmentMime(file.type),
    name: normalizeAttachmentName(file.name),
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
  };
}

function dataCarrierBytesForPayload(payload: string) {
  const output = bitcoin.payments.embed({
    data: [Buffer.from(payload, "utf8")],
  }).output;
  if (!output) throw new Error("Could not build OP_RETURN output.");
  return output.length;
}

function maxPayloadDataBytes(prefix: string) {
  let low = 0;
  let high = Math.max(0, MAX_DATA_CARRIER_BYTES - byteLength(prefix));
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const payload = `${prefix}${"x".repeat(candidate)}`;
    if (dataCarrierBytesForPayload(payload) <= MAX_DATA_CARRIER_BYTES) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }
  return low;
}

export function buildAttachmentPayloads(attachment: MailAttachment) {
  const metadataPrefix = `pwm1:a:${encodeTextBase64Url(attachment.mime)}:${encodeTextBase64Url(
    attachment.name,
  )}:${attachment.size}:${attachment.sha256}:`;
  const maxChunkBytes = maxPayloadDataBytes(`${metadataPrefix}999/999:`);
  const chunks = chunkAscii(attachment.data, Math.max(1, maxChunkBytes));
  return chunks.map(
    (chunk, index) => `${metadataPrefix}${index}/${chunks.length}:${chunk}`,
  );
}
