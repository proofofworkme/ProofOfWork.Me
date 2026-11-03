import { useEffect, useRef, useState } from "react";
import { fetchProofApiJson, proofApiUrl } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import type { MailAttachment } from "../../shared/protocol/mailAttachment";
import { POWCAT_MAX_FILE_BYTES, POWCAT_MAX_PARTS, powcatSha256 } from "../../shared/protocol/powcat1.mjs";
import { buildPowcatMailAttachment, type PowcatPointer } from "../../shared/protocol/powcatMail.mjs";

export type LinkedFile = PowcatPointer & {
  network: string;
  confirmed: boolean;
  name: string;
  mime: string;
  size: number;
  partTxids: string[];
  blockHeight: number;
  blockHash: string;
};
const hash = /^[a-f0-9]{64}$/u;

export async function readLinkedFile(txid: string, network: BitcoinNetwork, expectedHash?: string, signal?: AbortSignal) {
  if (network !== "livenet" || !hash.test(txid)) throw new Error("Enter a mainnet linker transaction ID.");
  const metadata = await fetchProofApiJson<LinkedFile>(`/api/v1/powcat/${txid}?fresh=1`, network, { signal, timeoutMs: 105_000 });
  if (metadata.network !== network || metadata.confirmed !== true || metadata.txid !== txid || !hash.test(metadata.fileHash) || (expectedHash && expectedHash !== metadata.fileHash) ||
      !Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > POWCAT_MAX_FILE_BYTES ||
      typeof metadata.name !== "string" || !metadata.name || metadata.name.includes("\\") || /[\\/\u0000-\u001f]/u.test(metadata.name) ||
      typeof metadata.mime !== "string" || !Array.isArray(metadata.partTxids) || !metadata.partTxids.length ||
      metadata.partTxids.length > POWCAT_MAX_PARTS || !metadata.partTxids.every(id => hash.test(id)) ||
      !Number.isSafeInteger(metadata.blockHeight) || metadata.blockHeight <= 0 || !hash.test(metadata.blockHash)) {
    throw new Error("The linked file could not be verified on this network.");
  }
  return metadata;
}

export async function readVerifiedPowcatBytes(file: LinkedFile, network: BitcoinNetwork, signal: AbortSignal) {
  const response = await fetch(proofApiUrl(`/api/v1/powcat/${file.txid}?download=1`, network),
    { signal, cache: "no-store", redirect: "error" });
  if (!response.ok || !response.body) throw new Error("The confirmed file is unavailable. Check again before downloading.");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(file.size);
  let offset = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (offset + part.value.length > bytes.length) throw new Error("The file exceeds its confirmed size.");
      bytes.set(part.value, offset);
      offset += part.value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (offset !== bytes.length || powcatSha256(bytes) !== file.fileHash) throw new Error("File size or SHA-256 verification failed.");
  signal.throwIfAborted();
  return bytes;
}

async function downloadVerifiedFile(file: LinkedFile, network: BitcoinNetwork, signal: AbortSignal) {
  const bytes = await readVerifiedPowcatBytes(file, network, signal);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PowcatLink({ network, pointer, onAttach, disabled = false }: {
  network: BitcoinNetwork; pointer?: PowcatPointer;
  onAttach?: (value: MailAttachment) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const active = useRef<AbortController | null>(null);
  const target = pointer?.txid ?? query.trim().toLowerCase();
  useEffect(() => () => active.current?.abort(), [network, pointer?.txid, pointer?.fileHash, disabled]);

  async function open() {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setWorking(true);
    setMessage("Verifying the linker and every file part…");
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const file = await readLinkedFile(target, network, pointer?.fileHash, controller.signal);
      controller.signal.throwIfAborted();
      if (onAttach) onAttach(buildPowcatMailAttachment(file));
      else await downloadVerifiedFile(file, network, controller.signal);
      setMessage(`${file.name} · ${file.size.toLocaleString()} bytes verified.`);
    } catch (error) {
      setMessage(controller.signal.aborted ? "Verification stopped. Try again." :
        error instanceof Error ? error.message : "File verification failed.");
    } finally {
      window.clearTimeout(timeout);
      active.current = null;
      setWorking(false);
    }
  }

  if (network !== "livenet") return null;
  return <div className="powcat-link">
    {pointer ? <div className="field-note">Linker TXID <code className="review-exact">{pointer.txid}</code></div> :
      <label>File linker TXID<input value={query} disabled={working || disabled} maxLength={64}
        autoComplete="off" spellCheck={false} onChange={event => { setQuery(event.target.value); setMessage(""); }} /></label>}
    <button type="button" className="secondary small" disabled={working || disabled || !hash.test(target)} onClick={() => void open()}>
      {working ? "Verifying…" : onAttach ? "Attach linked file" : "Verify and download"}
    </button>
    {message && <p className="field-note" role="status">{message}</p>}
  </div>;
}
