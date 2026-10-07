import { Buffer } from "buffer";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { sha256Hex } from "../../shared/utils/encoding";
import { JOB_TXID } from "./jobsApi";

export type JobsFile = { txid: string; name: string; mime: string; size: number; sha256: string; bytes: Uint8Array };
type Transaction = { txid?: string; status?: { confirmed?: boolean }; vout?: Array<{ scriptpubkey?: string; scriptPubKey?: { hex?: string }; value?: number }> };
function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new Error("File encoding is not canonical base64url.");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("File encoding is not canonical base64url.");
  return new Uint8Array(bytes);
}
function decodeText(value: string) { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodeBase64(value)); }
export function verifiedJobsFile(transaction: Transaction, txid: string): JobsFile | null {
  if (!JOB_TXID.test(txid) || transaction.txid !== txid || transaction.status?.confirmed !== true || !Array.isArray(transaction.vout)) throw new Error("Confirmed artifact transaction evidence is unavailable.");
  const parts: string[] = [];
  for (const output of transaction.vout) {
    if (output.scriptpubkey !== undefined && output.scriptPubKey?.hex !== undefined && output.scriptpubkey.toLowerCase() !== output.scriptPubKey.hex.toLowerCase()) throw new Error("Artifact script evidence disagrees.");
    const hex = output.scriptpubkey ?? output.scriptPubKey?.hex;
    if (typeof hex !== "string" || !/^(?:[a-f0-9]{2})+$/iu.test(hex)) throw new Error("Complete artifact scripts are unavailable.");
    const script = Buffer.from(hex, "hex");
    if (script[0] !== 0x6a) continue;
    if (output.value !== 0) throw new Error("Artifact record has an unexpected funded output.");
    const chunks: Uint8Array[] = [];
    let offset = 1;
    while (offset < script.length) {
      const opcode = script[offset++];
      let length: number;
      if (opcode <= 75) length = opcode;
      else if (opcode >= 76 && opcode <= 78) {
        const width = opcode === 76 ? 1 : opcode === 77 ? 2 : 4;
        if (offset + width > script.length) throw new Error("Artifact record script is truncated.");
        length = script.readUIntLE(offset, width); offset += width;
      } else throw new Error("Artifact record script is not push-only.");
      if (offset + length > script.length) throw new Error("Artifact record bytes are truncated.");
      chunks.push(script.subarray(offset, offset + length)); offset += length;
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    if (text.startsWith("pwm1:a:")) parts.push(text);
  }
  if (!parts.length) return null;
  let name = "", mime = "", size = 0, sha256 = "", count = 0;
  const chunks = new Map<number, string>();
  for (const part of parts) {
    const match = /^pwm1:a:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([1-9][0-9]*):([a-f0-9]{64}):(0|[1-9][0-9]*)\/([1-9][0-9]*):([A-Za-z0-9_-]+)$/u.exec(part);
    if (!match) throw new Error("Attachment metadata is malformed.");
    const nextMime = decodeText(match[1]), nextName = decodeText(match[2]), nextSize = Number(match[3]), index = Number(match[5]), total = Number(match[6]);
    if (!Number.isSafeInteger(nextSize) || nextSize > 60000 || !Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total > 1000 || index >= total || chunks.has(index)) throw new Error("Attachment parts or size are inconsistent.");
    if (chunks.size && (nextMime !== mime || nextName !== name || nextSize !== size || match[4] !== sha256 || total !== count)) throw new Error("Attachment metadata changed between parts.");
    name = nextName; mime = nextMime; size = nextSize; sha256 = match[4]; count = total; chunks.set(index, match[7]);
  }
  if (chunks.size !== count) throw new Error("Attachment parts are incomplete.");
  const data = Array.from({ length: count }, (_, index) => chunks.get(index) ?? "").join("");
  const bytes = decodeBase64(data);
  if (bytes.length !== size || sha256Hex(bytes) !== sha256) throw new Error("File bytes do not match their confirmed size and SHA-256.");
  return { txid, name, mime, size, sha256, bytes };
}
export async function fetchJobsFile(txid: string, network: BitcoinNetwork, signal?: AbortSignal) {
  const transaction = await fetchProofApiJson<Transaction>(`/api/v1/tx/${txid}`, network, { signal });
  return verifiedJobsFile(transaction, txid);
}
export function downloadJobsFile(file: JobsFile) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: "application/octet-stream" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; document.body.append(anchor); anchor.click(); anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
