import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";

export function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function sha256Hex(bytes: Uint8Array) {
  return bytesToHex(bitcoin.crypto.sha256(Buffer.from(bytes)));
}

export function base64UrlFromBase64(value: string) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function base64FromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

export function base64UrlEncodeBytes(bytes: Uint8Array) {
  return base64UrlFromBase64(Buffer.from(bytes).toString("base64"));
}

export function base64UrlDecodeBytes(value: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url data.");
  }

  return new Uint8Array(Buffer.from(base64FromBase64Url(value), "base64"));
}

export function encodeTextBase64Url(value: string) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

export function decodeTextBase64Url(value: string) {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    base64UrlDecodeBytes(value),
  );
}

export function chunkAscii(value: string, maxBytes: number) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += maxBytes) {
    chunks.push(value.slice(index, index + maxBytes));
  }

  return chunks.length ? chunks : [""];
}

export function chunkUtf8(value: string, maxBytes: number) {
  const chunks: string[] = [];
  let current = "";

  for (const character of value) {
    const next = `${current}${character}`;
    if (byteLength(next) > maxBytes) {
      chunks.push(current);
      current = character;
      continue;
    }

    current = next;
  }

  if (current || chunks.length === 0) {
    chunks.push(current);
  }

  return chunks;
}
