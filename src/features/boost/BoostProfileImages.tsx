import { useEffect, useRef, useState } from "react";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { imageMime, verifiedProfileImage, profileImageChoices, type Attachment, type FileChoice, type MailFile } from "./boostProfileMedia";
import type { BoostProfileImage } from "./boostProtocol";

// Share repeat avatars and bound transaction reads across a feed page.
const imageReads = new Map<string, { at: number; value: Promise<string> }>();
let activeImageReads = 0;
const imageReadQueue: Array<() => void> = [];
function readProfileImage(pointer: BoostProfileImage, network: BitcoinNetwork) {
  const key = JSON.stringify([network, pointer.txid, pointer.sha256, pointer.size, pointer.mime, pointer.name]);
  const cached = imageReads.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = (async () => {
    if (activeImageReads >= 4) await new Promise<void>(resolve => imageReadQueue.push(resolve));
    else activeImageReads += 1;
    try {
      const payload = await fetchProofApiJson<{ tx?: { status?: { confirmed?: boolean } }; attachment?: Attachment }>(
        `/api/v1/tx/${pointer.txid}`, network, { timeoutMs: 30_000 },
      );
      return payload.tx?.status?.confirmed === true ? verifiedProfileImage(pointer, payload.attachment) : "";
    } catch { return ""; }
    finally {
      const next = imageReadQueue.shift();
      if (next) next(); else activeImageReads -= 1;
    }
  })();
  if (imageReads.size >= 128) imageReads.delete(imageReads.keys().next().value!);
  imageReads.set(key, { at: Date.now(), value });
  return value;
}

export function ProfileImage({ pointer, network, className, fallback, alt = "" }: {
  pointer?: BoostProfileImage | null; network: BitcoinNetwork; className: string; fallback?: string; alt?: string;
}) {
  const [loaded, setLoaded] = useState<{ key: string; url: string }>();
  const key = JSON.stringify([network, pointer]);
  useEffect(() => {
    const controller = new AbortController();
    if (!pointer || !/^[a-f0-9]{64}$/u.test(pointer.txid ?? "") || !imageMime.test(pointer.mime ?? "")) return;
    void readProfileImage(pointer, network).then(url => {
      if (!controller.signal.aborted && url) setLoaded({ key, url });
    });
    return () => controller.abort();
  }, [key, network]);
  const url = loaded && loaded.key === key ? loaded.url : "";
  return url ? <img alt={alt} className={className} src={url}
    style={{ objectPosition: `${pointer?.positionX ?? 50}% ${pointer?.positionY ?? 50}%` }}
    onError={() => setLoaded(undefined)} /> : <div className={`${className} boost-avatar-fallback`} aria-label={alt || undefined}>{fallback}</div>;
}

export function BoostProfileImages({ address, network, busy, onPublish, onClose, publishStatus }: {
  address: string; network: BitcoinNetwork; busy: boolean;
  onPublish: (images: { image?: BoostProfileImage | null; banner?: BoostProfileImage | null }) => Promise<boolean>;
  publishStatus?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const publishing = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  busy = busy || submitting;
  const [files, setFiles] = useState<FileChoice[]>([]);
  const [status, setStatus] = useState("Loading confirmed image files…");
  const [slot, setSlot] = useState<"image" | "banner">("image");
  const [selection, setSelection] = useState<{ image?: FileChoice | null; banner?: FileChoice | null }>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setFiles([]); setStatus("Loading confirmed image files…");
    void fetchProofApiJson<{ inboxMessages?: MailFile[]; sentMessages?: MailFile[] }>(
      `/api/v1/address/${encodeURIComponent(address)}/mail?fresh=1`, network,
      { signal: controller.signal, timeoutMs: 30_000 },
    ).then(payload => {
      if (controller.signal.aborted) return;
      const choices = profileImageChoices(payload); setFiles(choices);
      setStatus(choices.length ? "Choose a file, then preview its crop." : "No confirmed image files. Send an image to your address in Computer, then refresh after confirmation.");
    }).catch(() => { if (!controller.signal.aborted) setStatus("Image files are unavailable. Refresh to retry."); });
    return () => controller.abort();
  }, [address, network, revision]);
  const selected = selection[slot];
  const changed = Object.keys(selection).length > 0;
  return <dialog className="boost-image-dialog" ref={dialog} aria-label="Profile images" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="boost-action-panel-head"><h2>Profile images</h2><button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button></div>
    <p>Choose images from your confirmed Inbox and Sent files.</p>
    <div className="boost-image-slots">
      {(["image", "banner"] as const).map(value => <button className="secondary" type="button" key={value} aria-pressed={slot === value}
        onClick={() => setSlot(value)}>{value === "image" ? "Profile picture" : "Banner"}{selection[value] !== undefined ? " · changed" : ""}</button>)}
    </div>
    <p role="status">{status}</p>
    <div className="boost-image-files" aria-label="Confirmed image files">
      {files.map(file => <button type="button" className="secondary" key={`${file.pointer.txid}:${file.pointer.sha256}`} disabled={busy}
        aria-pressed={selected?.pointer.txid === file.pointer.txid && selected?.pointer.sha256 === file.pointer.sha256}
        onClick={() => setSelection(previous => ({ ...previous, [slot]: file }))}>
        <img src={file.url} alt="" /><span>{file.pointer.name}</span>
      </button>)}
    </div>
    <div className="boost-image-slots"><button className="secondary" type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh files</button>
      <button className="secondary" type="button" disabled={busy} onClick={() => setSelection(previous => ({ ...previous, [slot]: null }))}>Remove {slot === "image" ? "picture" : "banner"}</button></div>
    {selected ? <div className="boost-image-preview">
      <img className={slot === "image" ? "boost-image-crop-avatar" : "boost-image-crop-banner"} src={selected.url} alt={`${slot === "image" ? "Profile picture" : "Banner"} preview`}
        style={{ objectPosition: `${selected.pointer.positionX ?? 50}% ${selected.pointer.positionY ?? 50}%` }} />
      {(["positionX", "positionY"] as const).map((axis) => <label key={axis}>{axis === "positionX" ? "Horizontal crop" : "Vertical crop"}
        <input type="range" min="0" max="100" value={selected.pointer[axis] ?? 50} disabled={busy} onChange={event => {
          const value = Number(event.target.value);
          setSelection(previous => ({ ...previous, [slot]: { ...selected, pointer: { ...selected.pointer, [axis]: value } } }));
        }} /></label>)}
    </div> : selected === null ? <p>This {slot === "image" ? "picture" : "banner"} will be removed.</p> : null}
    <p>Publish sends 546 proofs to your own address, plus the miner fee. Your wallet reviews and signs locally. Images change publicly after confirmation.</p>
    {publishStatus ? <p role="status">{publishStatus}</p> : null}
    <button className="primary" type="button" disabled={busy || !changed} onClick={async () => {
      if (publishing.current) return;
      publishing.current = true; setSubmitting(true);
      try { await onPublish(Object.fromEntries(Object.entries(selection).map(([key, file]) => [key, file?.pointer ?? null]))); }
      finally { publishing.current = false; setSubmitting(false); }
    }}>{busy ? "Publishing…" : "Publish images"}</button>
  </dialog>;
}
