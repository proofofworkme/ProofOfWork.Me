import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Wallet } from "lucide-react";
import { ReviewDialog } from "./ReviewDialog";
import { unisatMobileHandoff, UNISAT_DOWNLOAD_URL } from "../wallet/walletLinks";

/** A user-initiated navigation only; it never grants wallet authority here. */
export function UnisatMobileHandoff({ className = "primary" }: { className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<ReturnType<typeof unisatMobileHandoff>>();
  return <>
    <button ref={trigger} className={className} type="button" aria-label="Open in UniSat" onClick={() => {
      // Read at click time: Computer can change workspaces through history.
      setTarget(unisatMobileHandoff(window.location.href));
    }}>
      <Wallet size={15} /><span>Open in UniSat</span>
    </button>
    {target ? createPortal(<ReviewDialog title="Continue in UniSat" closeLabel="Close"
      returnFocus={trigger.current} onCancel={() => setTarget(undefined)}>
      <p>Open this page in UniSat’s browser, then tap Connect UniSat to approve access. This browser stays disconnected.</p>
      <p>Drafts, contacts and transaction recovery records stay in this browser. They do not move with you. Use backup and import for supported local data.</p>
      <p className="review-exact">{target.destination}</p>
      <p>If UniSat does not open, install or update the app, then try again.</p>
      <div className="review-actions">
        <a className="secondary link-button" href={UNISAT_DOWNLOAD_URL} target="_blank" rel="noreferrer">Install UniSat</a>
        <a className="primary link-button" href={target.href} rel="noreferrer">Open in UniSat</a>
      </div>
    </ReviewDialog>, document.body) : null}
  </>;
}
