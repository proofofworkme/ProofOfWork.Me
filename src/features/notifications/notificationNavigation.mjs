const TXID = /^[0-9a-f]{64}$/u;

// Build local read routes from explicit data, never an API-supplied URL.
export function notificationDestination(target, transactionId) {
  if (!TXID.test(transactionId)) throw new Error("Notification transaction evidence is unavailable.");
  const txid = TXID.test(target?.txid ?? "") ? target.txid : transactionId;
  switch (target?.workspace) {
    case "jobs": return { workspace: "jobs", params: { job: txid } };
    case "code": return { workspace: "code", params: { repo: txid, version: TXID.test(target.version ?? "") ? target.version : transactionId, tab: "history" } };
    case "permission": return { workspace: "permission", params: { permission: txid } };
    case "publish": return { workspace: "publish", params: { article: txid } };
    case "boost": return { workspace: "boost", params: { detail: txid } };
    case "browser": return { workspace: "browser", params: { txid } };
    default:
      // Search can inspect unsuccessful/historical attempts as well as accepted
      // actions. Current ownership screens and canonical-only Log cannot.
      return { workspace: "search", params: { q: transactionId, status: "all", valid: "all" } };
  }
}
