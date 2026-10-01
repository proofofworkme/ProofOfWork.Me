import type { ActionReceipt } from "../wallet/actionRecovery";

export function ActionRecoveryPanel({
  receipts,
  error,
  checking,
  restoringDisabled,
  canRestore,
  onRestore,
  onCheck,
  workspaceHref,
}: {
  receipts: ActionReceipt[];
  error: string;
  checking: boolean;
  restoringDisabled: boolean;
  canRestore: (receipt: ActionReceipt) => boolean;
  onRestore: (receipt: ActionReceipt) => void;
  onCheck: () => void;
  workspaceHref: (receipt: ActionReceipt) => string;
}) {
  const unresolved = receipts.filter(item => item.status === "unknown" || item.status === "pending");
  const resolved = receipts.filter(item => item.status === "confirmed" || item.status === "dropped");
  if (!receipts.length && !error) return null;

  const receiptCard = (item: ActionReceipt) => (
    <article className="review-recovery" key={`${item.network}:${item.txid}`}>
      <p><strong>{item.title}</strong> · {item.status === "unknown" ? "Broadcast outcome unknown" : item.status === "pending" ? "Pending confirmation" : item.status === "confirmed" ? "Confirmed transaction" : "Dropped transaction — review before retrying"}</p>
      <code className="review-exact">{item.txid}</code>
      <details>
        <summary>Inspect retained task</summary>
        <dl className="review-fields">{item.fields.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd><code className="review-exact">{value}</code></dd></div>
        ))}</dl>
      </details>
      <div className="action-recovery-actions">
        {canRestore(item) ? (
          <button type="button" className="secondary" disabled={restoringDisabled} onClick={() => onRestore(item)}>Restore task fields</button>
        ) : (
          <p className="field-note">Inspect and copy the retained fields, then resume in <a href={workspaceHref(item)}>the appropriate workspace</a>.</p>
        )}
        {item.status === "unknown" || item.status === "pending" ? (
          <button type="button" className="secondary" disabled={checking} onClick={onCheck}>{checking ? "Checking transaction status…" : "Check transaction status"}</button>
        ) : null}
      </div>
    </article>
  );

  return (
    <section className="action-recovery-panel" aria-label="Transaction recovery" aria-busy={checking}>
      {error ? <p role="alert" className="field-note">{error}</p> : null}
      <details className="action-recovery-disclosure">
        <summary>
          <span>Transaction recovery · {unresolved.length} unresolved{resolved.length ? ` · ${resolved.length} resolved` : ""}</span>
          {checking ? <span className="field-note" role="status">Checking statuses…</span> : null}
        </summary>
        <div className="action-recovery-content">
          <p className="field-note">Local recovery evidence. Pending is not confirmed ownership, routing, or balance. Restoring fields never submits a transaction.</p>
          {unresolved.map(receiptCard)}
          {resolved.length ? (
            <details className="action-recovery-history">
              <summary>Resolved transaction history ({resolved.length})</summary>
              {resolved.map(receiptCard)}
            </details>
          ) : null}
        </div>
      </details>
    </section>
  );
}
