import { ReviewDialog } from "./ReviewDialog";
import type { PreparedPaymentReview } from "../wallet/paymentReview";
import { useState } from "react";

export type MailTransactionReview = {
  evidence: PreparedPaymentReview;
  sender: string;
  networkLabel: string;
  feeRate: string;
  dustFeeProofs: string;
  recipients: { address: string; label: string; role: "To" | "CC"; proofs: string; work?: string }[];
  registry?: { address: string; proofs: string };
  totalWork?: string;
  subject: string;
  message: string;
  attachment?: { name: string; size: number; sha256: string };
};

export function TransactionReview({ review, onCancel, onApprove, returnFocus }: {
  review: MailTransactionReview; onCancel: () => void; onApprove: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  async function copyEvidence() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(review, null, 2));
      setCopyStatus("Exact review evidence copied.");
    } catch { setCopyStatus("Clipboard unavailable. Select and copy the evidence you need."); }
  }
  return <ReviewDialog title="Review mail transaction" onCancel={onCancel} returnFocus={returnFocus}>
    <p className="field-note">{review.networkLabel} · Signing stays in your local wallet.</p>
    <h3>Recipients and payments</h3>
    <ul className="review-list">{review.recipients.map(recipient => <li key={recipient.address}>
      <div className="review-value-row"><span>{recipient.role}{recipient.label !== recipient.address ? `: ${recipient.label}` : ""}</span><code>{recipient.proofs} proofs</code></div>
      <code className="review-exact">{recipient.address}</code>
      {recipient.work ? <p className="review-work"><code>{recipient.work} WORK</code> attached to this recipient</p> : null}
    </li>)}</ul>
    <dl className="review-fields">
      {review.totalWork ? <div><dt>Total WORK attached</dt><dd><code>{review.totalWork} WORK</code></dd></div> : null}
      {review.registry ? <div><dt>WORK registry payment</dt><dd><code>{review.registry.proofs} proofs</code><code className="review-exact">{review.registry.address}</code></dd></div> : null}
      <div><dt>Miner fee</dt><dd><code>{review.evidence.feeProofs} proofs</code> · selected rate {review.feeRate} proofs/vB</dd></div>
      {review.dustFeeProofs !== "0" ? <div><dt>Dust change added to miner fee</dt><dd><code>{review.dustFeeProofs} proofs</code> · included above</dd></div> : null}
      <div className="review-total"><dt>Total proofs spent</dt><dd><code>{review.evidence.totalSpendProofs} proofs</code></dd></div>
      <div><dt>Change returned to sender</dt><dd><code>{review.evidence.changeProofs} proofs</code><code className="review-exact">{review.sender}</code></dd></div>
    </dl>
    <details><summary>Inspect message and transaction evidence</summary>
      <p>{review.subject || "No subject"}</p><pre className="review-message">{review.message || "No message body"}</pre>
      {review.attachment ? <p>File: {review.attachment.name} · {review.attachment.size} bytes<br /><code className="review-exact">SHA-256: {review.attachment.sha256}</code></p> : null}
      <h3>Funding inputs</h3><ul className="review-list">{review.evidence.inputs.map(input => <li key={input.outpoint}><code className="review-exact">{input.outpoint}</code><code>{input.proofs} proofs</code></li>)}</ul>
      <h3>Prepared outputs</h3><ul className="review-list">{review.evidence.outputs.map(output => <li key={output.index}><span>Output {output.index} · {output.kind}</span><code className="review-exact">{output.address}</code><code>{output.proofs} proofs</code></li>)}</ul>
      <button className="secondary" type="button" onClick={() => void copyEvidence()}>Copy review evidence</button>
      {copyStatus ? <p className="field-note" role="status">{copyStatus}</p> : null}
    </details>
    <p>Recipients, message, and file contents are public on chain. Local archive or hide actions do not erase them.</p>
    <p className="field-note">Continue requests a transaction signature and broadcasts the signed transaction after existing safety checks. Pending visibility is not confirmed delivery.</p>
    <div className="review-actions"><button className="secondary" type="button" onClick={onCancel}>Back to compose</button><button className="primary" type="button" onClick={onApprove}>Continue to wallet</button></div>
  </ReviewDialog>;
}
