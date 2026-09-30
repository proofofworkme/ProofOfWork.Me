import { backupEntryCount, backupGroupLabel, RestorePlan } from "../localBackup";
import { ReviewDialog } from "./ReviewDialog";
import { useState } from "react";

export function BackupPreview({ plan, fileName, ignoredKeys, error, onCancel, onRestore, returnFocus }: {
  plan: RestorePlan; fileName: string; ignoredKeys: number; error?: string;
  onCancel: () => void; onRestore: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const keys = [...new Set([...Object.keys(plan.previous), ...Object.keys(plan.data)])].sort();
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 25;
  const replacementCount = Object.keys(plan.data).length;
  const visibleKeys = keys.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  return <ReviewDialog title="Review local restore" onCancel={onCancel} returnFocus={returnFocus}>
    <p className="review-exact">{fileName}</p>
    <p>Matching storage groups are replaced in full. Groups absent from this backup remain unchanged.</p>
    <p>{replacementCount} groups will be replaced; {keys.length - replacementCount} current groups will be kept. Approval applies to all supported groups across pages.</p>
    {keys.length > pageSize ? <nav className="review-value-row" aria-label="Restore inventory pages">
      <button className="secondary" type="button" disabled={pageIndex === 0} onClick={() => setPageIndex(index => index - 1)}>Previous groups</button>
      <span role="status">Groups {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, keys.length)} of {keys.length}</span>
      <button className="secondary" type="button" disabled={(pageIndex + 1) * pageSize >= keys.length} onClick={() => setPageIndex(index => index + 1)}>Next groups</button>
    </nav> : null}
    <ul className="review-list">{visibleKeys.map(key => <li key={key}>
      <h3 className="review-exact">{backupGroupLabel(key)}</h3>
      <div className="review-value-row"><span>Current: {backupEntryCount(plan.previous[key])}</span><span>Backup: {backupEntryCount(plan.data[key])}</span></div>
      <p className="field-note">{Object.prototype.hasOwnProperty.call(plan.data, key) ? "Replace this group" : "Keep current group"}</p>
      <details><summary>Inspect storage key</summary><code className="review-exact">{key}</code></details>
    </li>)}</ul>
    <p>{ignoredKeys} unsupported key{ignoredKeys === 1 ? "" : "s"} ignored. Wallet secrets, connection state, and theme are excluded.</p>
    <p>Restoring local tracking and organization does not change confirmed chain history. Backup files contain local messages and contacts.</p>
    {error ? <p className="field-note bad" role="alert">{error}</p> : null}
    <div className="review-actions"><button className="secondary" type="button" onClick={onCancel}>Keep current data</button><button className="primary" type="button" disabled={Boolean(error)} onClick={onRestore}>Replace listed local groups</button></div>
  </ReviewDialog>;
}
