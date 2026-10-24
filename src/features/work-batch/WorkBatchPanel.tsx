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
  const [refresh, setRefresh] = useState(0);
  const controller = useRef<AbortController>();
  useEffect(() => {
    const current = new AbortController();
    setLoading(true); setStatus(undefined); setStatusError("");
    if (network !== "livenet") { setLoading(false); return () => current.abort(); }
    void loadStatus(current.signal).then(value => {
      if (!current.signal.aborted) setStatus(readWorkBatchStatus(value));
    }).catch(reason => {
      if (!current.signal.aborted) setStatusError(reason instanceof Error ? reason.message : "Batch status unavailable.");
    }).finally(() => { if (!current.signal.aborted) setLoading(false); });
    return () => current.abort();
  }, [network, loadStatus, refresh]);
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
  const ready = status?.ready === true && status.active && status.writeEnabled;
  return <details className="work-batch-panel">
    <summary>Send WORK to many</summary>
    <p>Send WORK to 2–256 wallets in one transaction. The whole batch pays one 546-proof registry fee, plus its miner fee.</p>
    <div className="work-batch-status" role="status">
      <span>{network !== "livenet" ? "Switch to Mainnet for WORK batch sending."
        : loading ? "Checking batch activation…" : statusError || (ready ? "Batch sending is active. Current state is checked again before signing."
          : `Batch sending is unavailable until its declaration is confirmed, activated, and verified${status?.reasonCode ? ` (${status.reasonCode})` : ""}.`)}</span>
      <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)} disabled={busy || loading}>Refresh status</button>
    </div>
    <form className="id-form" onSubmit={event => { event.preventDefault(); if (draft) void onPrepare(draft); }}>
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
