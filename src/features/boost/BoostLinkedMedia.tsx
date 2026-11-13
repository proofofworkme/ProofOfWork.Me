import { useEffect, useRef, useState } from "react";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { powcatPointerFromAttachment } from "../../shared/protocol/powcatMail.mjs";
import { PowcatLink, readLinkedFile, readVerifiedPowcatBytes, type LinkedFile } from "../powcat/PowcatLink";
import type { MailAttachment } from "../../shared/protocol/mailAttachment";
import type { BoostFeedItem } from "./boostProtocol";
import { boostMediaUrl } from "./boostMedia";

// A social post commits the small Mail pointer, not a second copy of the file.
// Resolve only on request: a feed must not automatically download 4 MB per post.
export function BoostLinkedMedia({ item, network }: { item: BoostFeedItem; network: BitcoinNetwork }) {
  const [file, setFile] = useState<LinkedFile>();
  const [preview, setPreview] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const objectUrl = useRef("");
  const txid = item.boostTxid || item.txid;
  useEffect(() => {
    setFile(undefined); setPreview(""); setNotice(""); setBusy(false);
    return () => { active.current?.abort(); active.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ""; };
  }, [txid, network, item.confirmed, item.media?.sha256]);
  async function open() {
    if (active.current || !item.confirmed) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setNotice("");
    setFile(undefined); setPreview("");
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const readPost = () => fetchProofApiJson<{ attachment?: MailAttachment; txid?: string; network?: string; confirmed?: boolean }>(`/api/v1/tx/${encodeURIComponent(txid)}`, network,
        { signal: controller.signal, timeoutMs: 30_000 });
      const payload = await readPost();
      if (payload.txid !== txid || payload.network !== network || payload.confirmed !== true ||
          item.media?.source !== "same-tx-pwm1-attachment") throw new Error("Confirmed post evidence is unavailable.");
      if (!boostMediaUrl(item.media, payload.attachment)) throw new Error("The post's file reference could not be verified.");
      const pointer = powcatPointerFromAttachment(payload.attachment);
      if (!pointer) throw new Error("The post does not contain a valid linked-file reference.");
      const verified = await readLinkedFile(pointer.txid, network, pointer.fileHash, controller.signal);
      let previewBytes: Uint8Array<ArrayBuffer> | undefined;
      if (/^(?:image\/(?:png|jpeg|gif|webp|avif)|video\/(?:mp4|webm|ogg))$/u.test(verified.mime)) {
        previewBytes = await readVerifiedPowcatBytes(verified, network, controller.signal);
      }
      const after = await readPost();
      if (after.confirmed !== true || after.txid !== txid || after.network !== network || !boostMediaUrl(item.media, after.attachment)) {
        throw new Error("The post changed while its linked file was being verified.");
      }
      controller.signal.throwIfAborted();
      const url = previewBytes ? URL.createObjectURL(new Blob([previewBytes], {type: verified.mime})) : "";
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = url; setFile(verified); setPreview(url);
    } catch (error) {
      if (active.current === controller) setNotice(controller.signal.aborted ? "File verification stopped. Try again." : error instanceof Error ? error.message : "The linked file is unavailable.");
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  if (!item.confirmed) return <p className="field-note">Linked file preview awaits confirmed post evidence.</p>;
  return <div className="boost-linked-media">
    <button type="button" className="secondary small" disabled={busy} onClick={() => void open()}>
      {busy ? "Verifying linked file…" : file ? "Recheck linked file" : "Open linked file (up to 4 MB)"}
    </button>
    {notice && <p className="field-note" role="status">{notice}</p>}
    {file && <><p className="field-note">{file.name} · {file.size.toLocaleString()} bytes · verified linked file</p>
      {preview && (file.mime.startsWith("video/") ? <video className="boost-post-media" controls preload="metadata" src={preview} /> :
        <img className="boost-post-media" alt={file.name} src={preview} />)}
      <PowcatLink network={network} pointer={{txid: file.txid, fileHash: file.fileHash}} />
    </>}
  </div>;
}
