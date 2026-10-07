import { useState } from "react";
import { ReviewDialog } from "./ReviewDialog";
import type { PreparedPaymentReview } from "../wallet/paymentReview";
export type ActionReview = {
  title: string; networkLabel: string; fields: [string, string][];
  evidence?: PreparedPaymentReview; feeRate: string; dustFeeProofs: string;
  paymentLabels?: string[]; explanation?: string; walletSpendProofs?: string;
};
export function ActionTransactionReview({ review, onCancel, onApprove, returnFocus }: {
  review: ActionReview; onCancel: () => void; onApprove: () => void; returnFocus: HTMLElement | null;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  return <ReviewDialog title={review.title} onCancel={onCancel} returnFocus={returnFocus}>
    <p>{review.networkLabel} · Signing stays in your local wallet.</p>
    <dl className="review-fields">{review.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code className="review-exact">{value}</code></dd></div>)}</dl>
    {review.explanation ? <p>{review.explanation}</p> : null}
    {review.evidence ? <>
    <h3>Payments and fees</h3>
    <ul className="review-list">{review.evidence.outputs.filter(output => output.kind !== "record").map(output => <li key={output.index}><span>{output.kind === "payment" ? review.paymentLabels?.[review.evidence!.outputs.filter(item => item.kind === "payment").findIndex(item => item.index === output.index)] ?? "Registry payment" : "Change returned to your wallet"}</span><code className="review-exact">{output.address}</code><code>{output.proofs} proofs</code></li>)}</ul>
    <dl className="review-fields"><div><dt>Miner fee</dt><dd><code>{review.evidence.feeProofs} proofs</code> · selected rate {review.feeRate} proofs/vB</dd></div>
      {review.dustFeeProofs !== "0" ? <div><dt>Dust change included in miner fee</dt><dd><code>{review.dustFeeProofs} proofs</code></dd></div> : null}
      <div className="review-total"><dt>{review.paymentLabels ? "Wallet proofs used" : "Total proofs spent"}</dt><dd><code>{review.walletSpendProofs ?? review.evidence.totalSpendProofs} proofs</code></dd></div></dl>
    <details><summary>Inspect exact transaction evidence</summary><h3>Funding inputs</h3><ul className="review-list">{review.evidence.inputs.map(input => <li key={input.outpoint}><code className="review-exact">{input.outpoint}</code><code>{input.proofs} proofs</code></li>)}</ul>
      {review.evidence.records.map((record, index) => <pre className="review-message review-protocol" key={index}>{record}</pre>)}
      <button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(review, null, 2)); setCopyStatus("Exact review evidence copied."); } catch { setCopyStatus("Clipboard unavailable. Select the exact evidence to copy it."); } }}>Copy review evidence</button><p role="status">{copyStatus}</p></details>
    </> : null}
    <p>{review.evidence ? "Continue requests a transaction signature, then broadcasts after fresh safety checks. The record is public and permanent. Pending visibility does not establish confirmed ownership, routing, or balances." : "Continue requests a reusable seller signature only. It does not broadcast a transaction. A separate review follows for the registry payment and miner fee needed to publish the seal."}</p>
    <div className="review-actions"><button className="secondary" type="button" onClick={onCancel}>Back to task</button><button className="primary" type="button" onClick={onApprove}>Continue to wallet</button></div>
  </ReviewDialog>;
}
