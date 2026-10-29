import { useEffect, useRef, useState, type ReactNode } from "react";
import { workDecimalFromAtoms } from "../../workAmount";
import { readWorkBatchStatus, type WorkBatchDraft, type WorkBatchStatus } from "./workBatchClient.mjs";
import "./workBatch.css";

export function WorkBatchPanel({ address, network, recipients, amountEach, setRecipients, setAmountEach, busy, feeControl, loadStatus, resolveDraft, onPrepare }: {
  address: string; network: string; recipients: string; amountEach: string;
  setRecipients: (value: string) => void; setAmountEach: (value: string) => void; busy: boolean; feeControl: ReactNode;
  loadStatus: (signal?: AbortSignal) => Promise<unknown>;
  resolveDraft: (recipients: string, amountEach: string, signal?: AbortSignal) => Promise<WorkBatchDraft>;
  onPrepare: (draft: WorkBatchDraft) => Promise<void>;
}) {
  const [status, setStatus] = useState<WorkBatchStatus>();
  const [statusError, setStatusError] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<WorkBatchDraft>();
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const statusFlight = useRef<Promise<void>>();
  const statusActions = useRef({ refresh: () => {}, pause: () => {} });
  const preparing = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const controller = useRef<AbortController>();
  useEffect(() => {
    let stopped = false;
    let active = false;
    let queued = false;
    let current: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = -Infinity;
    const visible = () => document.visibilityState === "visible";
    const clearTimer = () => { clearTimeout(timer); timer = undefined; };
    const pause = () => {
      clearTimer(); queued = false; current?.abort();
      setStatus(undefined); setLoading(false);
    };
    const refresh = () => {
      if (stopped) return;
      clearTimer(); setStatus(undefined); setStatusError("");
      if (network !== "livenet" || !visible() || busyRef.current || preparing.current) { setLoading(false); return; }
      setLoading(true);
      if (active) {
        if (current?.signal.aborted) queued = true;
        return;
      }
      active = true; queued = false; startedAt = Date.now();
      const request = new AbortController(); current = request;
      const previous = statusFlight.current;
      // Wait for a cancelled read to settle before starting its replacement.
      // This also serializes a changed network or loadStatus callback.
      statusFlight.current = (async () => {
        try {
          await previous;
          if (stopped || request.signal.aborted) return;
          const value = await loadStatus(request.signal);
          if (!stopped && !request.signal.aborted) setStatus(readWorkBatchStatus(value));
        } catch (reason) {
          if (!stopped && !request.signal.aborted) setStatusError(reason instanceof Error ? reason.message : "Batch status unavailable.");
        } finally {
          active = false;
          if (!stopped) {
            if (queued && visible()) refresh();
            else {
              setLoading(false);
              if (!request.signal.aborted && visible() && details.current?.open) timer = setTimeout(refresh, 30_000);
            }
          }
        }
      })();
    };
    const focused = () => { if (details.current?.open && Date.now() - startedAt >= 1_000) refresh(); };
    const visibilityChanged = () => {
      if (!visible()) pause();
      else if (details.current?.open) refresh();
    };
    statusActions.current = { refresh, pause };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", focused);
    refresh();
    return () => {
      stopped = true; queued = false; clearTimer(); current?.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", focused);
    };
  }, [network, loadStatus]);
  useEffect(() => {
    if (busy) statusActions.current.pause();
    else if (!preparing.current && details.current?.open) statusActions.current.refresh();
  }, [busy]);
  useEffect(() => {
    controller.current?.abort(); setDraft(undefined); setError(""); setChecking(false);
    return () => controller.current?.abort();
  }, [recipients, amountEach, address, network]);
  async function checkRecipients() {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setChecking(true); setDraft(undefined); setError("");
    try { const value = await resolveDraft(recipients, amountEach, current.signal); if (!current.signal.aborted) setDraft(value); }
    catch (reason) { if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : "Recipients unavailable."); }
    finally { if (!current.signal.aborted) setChecking(false); }
  }
  const ready = network === "livenet" && !loading && !statusError && status?.ready === true && status.active && status.writeEnabled;
  async function prepareBatch() {
    if (preparing.current || busy || checking || !draft || !address || !ready) return;
    preparing.current = true; setError(""); statusActions.current.pause();
    try { await onPrepare(draft); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Batch preparation unavailable."); }
    finally { preparing.current = false; statusActions.current.refresh(); }
  }
  return <details ref={details} className="work-batch-panel" onToggle={event => {
    if (event.currentTarget.open) statusActions.current.refresh();
    else statusActions.current.pause();
  }}>
    <summary>Send WORK to many</summary>
    <p>Send WORK to 2–256 wallets in one transaction. The whole batch pays one 546-proof registry fee, plus its miner fee.</p>
    <div className="work-batch-status" role="status">
      <span>{network !== "livenet" ? "Switch to Mainnet for WORK batch sending."
        : loading ? "Checking batch availability…" : statusError || (ready ? "Batch sending is active. Current state is checked again before signing."
          : status?.active && !status.writeEnabled ? `Batch sending is active, but writes are disabled. Refresh status before reviewing${status.reasonCode ? ` (${status.reasonCode})` : ""}.`
          : status?.active ? `Batch sending is active but temporarily paused. Your recipients are kept; refresh status before reviewing${status.reasonCode ? ` (${status.reasonCode})` : ""}.`
          : status ? `Batch sending is unavailable until its declaration is confirmed, activated, and verified${status.reasonCode ? ` (${status.reasonCode})` : ""}.`
          : "Batch availability has not been verified. Refresh status before reviewing.")}</span>
      <button type="button" className="secondary" onClick={() => statusActions.current.refresh()} disabled={busy || loading}>Refresh status</button>
    </div>
    <form className="id-form" onSubmit={event => { event.preventDefault(); void prepareBatch(); }}>
      <label>Recipients
        <textarea rows={5} value={recipients} disabled={busy} onChange={event => setRecipients(event.target.value)} placeholder="alice@proofofwork.me, bob@proofofwork.me" aria-describedby="work-batch-recipient-help" />
      </label>
      <p className="field-note" id="work-batch-recipient-help">Separate confirmed ProofOfWork IDs or addresses with commas, semicolons, or new lines. IDs use their confirmed receiver. Duplicate wallets must be removed.</p>
      <label>WORK each<input inputMode="decimal" type="text" value={amountEach} disabled={busy} onChange={event => setAmountEach(event.target.value)} /></label>
      <button className="secondary" type="button" onClick={() => void checkRecipients()} disabled={busy || checking || network !== "livenet"}>{checking ? "Checking recipients…" : "Check recipients"}</button>
      {error ? <p className="field-note bad" role="alert">{error}</p> : null}
      {draft ? <>
        <div className="work-batch-totals"><span>{draft.recipientCount} wallets</span><strong>{workDecimalFromAtoms(draft.totalAmountSubatoms)} WORK total</strong><span>546 proofs registry fee + miner fee</span></div>
        <div className="work-batch-destinations" tabIndex={0} aria-label="Verified batch recipients">
          <table><thead><tr><th scope="col">Recipient</th><th scope="col">Resolved address</th><th scope="col">WORK</th></tr></thead>
            <tbody>{draft.destinations.map(row => <tr key={row.recipientAddress}><td>{row.id ? `${row.id}@proofofwork.me` : "Address"}</td><td><code>{row.recipientAddress}</code></td><td>{workDecimalFromAtoms(row.amountSubatoms)}</td></tr>)}</tbody>
          </table>
        </div>
      </> : null}
      {feeControl}
      <p className="field-note">Only WORK goes to the recipients. This transfer does not send Mail or recipient proof payments. Review every destination before approving in your local wallet.</p>
      <button className="primary" type="submit" disabled={busy || checking || !draft || !address || !ready}>{busy ? "Preparing batch…" : "Review WORK batch"}</button>
      {!address ? <p className="field-note">Connect UniSat to prepare a batch.</p> : null}
    </form>
  </details>;
}
